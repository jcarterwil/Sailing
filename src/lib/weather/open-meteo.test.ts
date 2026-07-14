import { describe, expect, it } from "vitest";

import {
  ANALYZED_WIND_REPORT_LABEL,
  chooseWeatherDataset,
  geocodeWeatherLocation,
  normalizeWeatherHourlySamples,
  summarizeOpenMeteoWeather,
  WEATHER_CONTEXT_REPORT_LABEL,
  weatherCodeToText,
  type WeatherLocation,
} from "@/lib/weather/open-meteo";

const location: WeatherLocation = {
  name: "Harbor Springs",
  admin1: "Michigan",
  country: "United States",
  latitude: 45.43,
  longitude: -84.99,
  timezone: "America/Detroit",
};

describe("Open-Meteo weather evidence", () => {
  it("selects the appropriate live or historical dataset", () => {
    const now = new Date("2026-07-12T12:00:00Z");
    expect(chooseWeatherDataset(new Date("2026-07-10T12:00:00Z"), now)).toBe("forecast");
    expect(chooseWeatherDataset(new Date("2026-06-01T12:00:00Z"), now)).toBe(
      "historical-forecast",
    );
    expect(chooseWeatherDataset(new Date("2000-06-01T12:00:00Z"), now)).toBe(
      "historical-weather",
    );
  });

  it("geocodes a venue and encodes the query", async () => {
    let requested = "";
    const fetcher: typeof fetch = async (input) => {
      requested = String(input);
      return Response.json({
        results: [
          {
            name: "Harbor Springs",
            admin1: "Michigan",
            country: "United States",
            latitude: 45.43,
            longitude: -84.99,
            timezone: "America/Detroit",
          },
        ],
      });
    };
    await expect(geocodeWeatherLocation("Little Traverse Bay, MI", fetcher)).resolves.toEqual(
      location,
    );
    expect(requested).toContain("name=Little+Traverse+Bay%2C+MI");
  });

  it("summarizes the race window and handles north-crossing wind directions", () => {
    const evidence = summarizeOpenMeteoWeather(
      {
        hourly: {
          time: ["2026-07-07T21:00", "2026-07-07T22:00", "2026-07-07T23:00"],
          wind_speed_10m: [5, 10, 14],
          wind_direction_10m: [180, 350, 10],
          wind_gusts_10m: [8, 15, 20],
          temperature_2m: [20, 19, 18],
          precipitation: [0, 0.2, 0.3],
          cloud_cover: [10, 40, 60],
          pressure_msl: [1014, 1013, 1012],
          weather_code: [0, 61, 61],
        },
      },
      location,
      new Date("2026-07-07T22:10:00Z"),
      new Date("2026-07-07T23:20:00Z"),
      "historical-forecast",
      "https://weather.example/atmosphere",
      {
        hourly: {
          time: ["2026-07-07T22:00", "2026-07-07T23:00"],
          wave_height: [0.2, 0.4],
          wave_period: [3, 5],
          wave_direction: [350, 10],
        },
      },
      "https://weather.example/marine",
      new Date("2026-07-12T12:00:00Z"),
    );

    expect(evidence).toMatchObject({
      windMinKts: 10,
      windMaxKts: 14,
      windDirectionDeg: 6,
      averageWindKts: 12.9,
      conditionCode: 61,
      gustMaxKts: 20,
      precipitationMm: 0.5,
      cloudCoverPct: 50,
      sampleCount: 2,
      waveHeightMinM: 0.2,
      waveHeightMaxM: 0.4,
      wavePeriodS: 4,
      waveDirectionDeg: 0,
    });
    expect(evidence.hourly).toEqual([
      {
        time: "2026-07-07T22:00:00.000Z",
        windSpeedKts: 10,
        windDirectionDeg: 350,
        gustKts: 15,
        temperatureC: 19,
        weatherCode: 61,
      },
      {
        time: "2026-07-07T23:00:00.000Z",
        windSpeedKts: 14,
        windDirectionDeg: 10,
        gustKts: 20,
        temperatureC: 18,
        weatherCode: 61,
      },
    ]);
  });

  it("ignores truncated optional hourly arrays instead of producing NaN", () => {
    const evidence = summarizeOpenMeteoWeather(
      {
        hourly: {
          time: ["2026-07-07T22:00", "2026-07-07T23:00"],
          wind_speed_10m: [10, 12],
          wind_direction_10m: [270, 280],
          wind_gusts_10m: [15],
        },
      },
      location,
      new Date("2026-07-07T22:40:00Z"),
      new Date("2026-07-07T23:20:00Z"),
      "historical-forecast",
      "https://weather.example/atmosphere",
    );

    expect(evidence.gustMaxKts).toBeNull();
    expect(Number.isFinite(evidence.windMinKts)).toBe(true);
  });

  it("uses the same paired samples for wind range and direction", () => {
    const evidence = summarizeOpenMeteoWeather(
      {
        hourly: {
          time: ["2026-07-07T22:00", "2026-07-07T23:00"],
          wind_speed_10m: [10, 30],
          wind_direction_10m: [270],
        },
      },
      location,
      new Date("2026-07-07T22:00:00Z"),
      new Date("2026-07-07T23:00:00Z"),
      "historical-forecast",
      "https://weather.example/atmosphere",
    );

    expect(evidence.windMinKts).toBe(10);
    expect(evidence.windMaxKts).toBe(10);
    expect(evidence.windDirectionDeg).toBe(270);
  });

  it("duration-weights wind summaries and breaks condition ties deterministically", () => {
    const evidence = summarizeOpenMeteoWeather(
      {
        hourly: {
          time: ["2026-07-07T22:00", "2026-07-07T23:00"],
          wind_speed_10m: [10, 20],
          wind_direction_10m: [359, 1],
          weather_code: [0, 3],
        },
      },
      location,
      new Date("2026-07-07T22:10:00Z"),
      new Date("2026-07-07T23:20:00Z"),
      "historical-forecast",
      "https://weather.example/atmosphere",
    );

    expect(evidence.averageWindKts).toBe(17.1);
    expect(evidence.windDirectionDeg).toBe(1);
    expect(evidence.conditionCode).toBe(3);
  });

  it("normalizes stored hourly rows with stable ordering, deduplication, and bounds", () => {
    expect(normalizeWeatherHourlySamples([
      {
        time: "2026-07-07T23:00:00Z",
        windSpeedKts: -1,
        windDirectionDeg: 361,
        gustKts: Number.NaN,
        temperatureC: 18,
        weatherCode: 61,
      },
      {
        time: "2026-07-07T22:00:00Z",
        windSpeedKts: 10,
        windDirectionDeg: 359,
        gustKts: 14,
        temperatureC: 19,
        weatherCode: 0,
      },
      {
        time: "2026-07-07T22:00:00Z",
        windSpeedKts: 20,
        windDirectionDeg: 180,
        gustKts: 25,
        temperatureC: 20,
        weatherCode: 3,
      },
    ])).toEqual([
      {
        time: "2026-07-07T22:00:00.000Z",
        windSpeedKts: 10,
        windDirectionDeg: 359,
        gustKts: 14,
        temperatureC: 19,
        weatherCode: 0,
      },
      {
        time: "2026-07-07T23:00:00.000Z",
        windSpeedKts: null,
        windDirectionDeg: 1,
        gustKts: null,
        temperatureC: 18,
        weatherCode: 61,
      },
    ]);
    expect(normalizeWeatherHourlySamples(Array.from({ length: 27 }, (_, index) => ({
      time: new Date(Date.UTC(2026, 6, 7, index)).toISOString(),
    })))).toBeNull();
  });

  it("maps Open-Meteo weather codes to deterministic report text", () => {
    expect(weatherCodeToText(0)).toBe("Clear sky");
    expect(weatherCodeToText(95)).toBe("Thunderstorm");
    expect(weatherCodeToText(42)).toBe("Weather code 42");
    expect(weatherCodeToText(null)).toBe("Unavailable");
    expect(ANALYZED_WIND_REPORT_LABEL).toBe("Analyzed wind used for VMG");
    expect(WEATHER_CONTEXT_REPORT_LABEL).toBe("Weather context (Open-Meteo)");
  });
});
