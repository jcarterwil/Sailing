import { describe, expect, it } from "vitest";

import {
  chooseWeatherDataset,
  geocodeWeatherLocation,
  summarizeOpenMeteoWeather,
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
      windDirectionDeg: 2,
      gustMaxKts: 20,
      precipitationMm: 0.5,
      cloudCoverPct: 50,
      sampleCount: 2,
      waveHeightMinM: 0.2,
      waveHeightMaxM: 0.4,
      wavePeriodS: 4,
      waveDirectionDeg: 0,
    });
  });
});
