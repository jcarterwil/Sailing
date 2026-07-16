import { render } from "@react-email/render";

/* eslint-disable @next/next/no-head-element -- this renders standalone email HTML, not a Next page */

interface SailingEmailTemplateProps {
  preview: string;
  heading: string;
  recipientName?: string | null;
  body: string;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  preferencesUrl?: string | null;
}

function SailingEmailTemplate({
  preview,
  heading,
  recipientName,
  body,
  ctaLabel,
  ctaUrl,
  preferencesUrl,
}: SailingEmailTemplateProps) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{heading}</title>
      </head>
      <body style={{ margin: 0, backgroundColor: "#f3f5f7", color: "#17202a" }}>
        <div style={{ display: "none", maxHeight: 0, overflow: "hidden", opacity: 0 }}>
          {preview}
        </div>
        <table role="presentation" width="100%" cellPadding="0" cellSpacing="0">
          <tbody>
            <tr>
              <td align="center" style={{ padding: "32px 16px" }}>
                <table
                  role="presentation"
                  width="100%"
                  cellPadding="0"
                  cellSpacing="0"
                  style={{
                    maxWidth: "600px",
                    border: "1px solid #dce2e8",
                    borderRadius: "12px",
                    backgroundColor: "#ffffff",
                    overflow: "hidden",
                    fontFamily: "Arial, Helvetica, sans-serif",
                  }}
                >
                  <tbody>
                    <tr>
                      <td style={{ padding: "22px 28px", backgroundColor: "#102d3e" }}>
                        <div style={{ color: "#b9d8e8", fontSize: "13px", letterSpacing: "0.12em" }}>
                          SAILING
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: "30px 28px 20px" }}>
                        <h1 style={{ margin: "0 0 18px", fontSize: "26px", lineHeight: 1.25 }}>
                          {heading}
                        </h1>
                        {recipientName ? (
                          <p style={{ margin: "0 0 16px", fontSize: "16px", lineHeight: 1.6 }}>
                            Hi {recipientName},
                          </p>
                        ) : null}
                        <p
                          style={{
                            margin: 0,
                            fontSize: "16px",
                            lineHeight: 1.65,
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {body}
                        </p>
                        {ctaLabel && ctaUrl ? (
                          <p style={{ margin: "26px 0 4px" }}>
                            <a
                              href={ctaUrl}
                              style={{
                                display: "inline-block",
                                borderRadius: "8px",
                                backgroundColor: "#087f8c",
                                color: "#ffffff",
                                fontSize: "15px",
                                fontWeight: 700,
                                padding: "12px 18px",
                                textDecoration: "none",
                              }}
                            >
                              {ctaLabel}
                            </a>
                          </p>
                        ) : null}
                      </td>
                    </tr>
                    <tr>
                      <td
                        style={{
                          borderTop: "1px solid #e7ebef",
                          padding: "18px 28px 24px",
                          color: "#687480",
                          fontSize: "12px",
                          lineHeight: 1.5,
                        }}
                      >
                        This message was sent by Sailing.
                        {preferencesUrl ? (
                          <>
                            {" "}
                            <a href={preferencesUrl} style={{ color: "#087f8c" }}>
                              Manage email preferences
                            </a>
                            .
                          </>
                        ) : null}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}

export async function renderSailingEmail(props: SailingEmailTemplateProps): Promise<string> {
  return render(<SailingEmailTemplate {...props} />);
}

export function buildPlainTextEmail(props: SailingEmailTemplateProps): string {
  return [
    props.recipientName ? `Hi ${props.recipientName},` : null,
    props.body,
    props.ctaLabel && props.ctaUrl ? `${props.ctaLabel}: ${props.ctaUrl}` : null,
    props.preferencesUrl ? `Manage email preferences: ${props.preferencesUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}
