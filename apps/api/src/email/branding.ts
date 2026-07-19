/**
 * Shared branded HTML layout for all outbound Music & Life emails.
 *
 * Email clients strip <style> and external CSS unpredictably, so everything
 * here is table-based with inline styles and web-safe font fallbacks. Keep it
 * single-column and <=600px so it renders well on mobile and in Gmail/Outlook.
 *
 * Palette matches the London studio portal: deep pine green on warm cream.
 */

export const BRAND = {
  name: 'Music & Life',
  locality: 'London',
  portalUrl: 'https://lirico.uk/login',
  website: 'https://www.musicandlife.co.uk',
  supportEmail: 'office@musicandlife.co.uk',
  phone: '+44 7848 115 447',
  address: '10 High Street, Pinner HA5 5PW',
  // Colours
  pine: '#1e3a2e',   // brand wordmark, headings, primary button, emphasised values
  moss: '#2f6a4d',   // links
  ink: '#33372f',    // body copy
  paper: '#f6f4ec',  // page + header/footer background (warm cream)
  panel: '#f1efe6',  // detail block background
  line: '#e5e2d5',   // hairline borders
  muted: '#8a887c',  // labels, footer, fine print
} as const;

const FONT = "'Lexend', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";

export interface BrandedEmailOptions {
  /** Hidden preview/snippet text shown in the inbox list. */
  previewText?: string;
  /** Big heading at the top of the card. */
  heading: string;
  /** Main body — already-escaped HTML (paragraphs, lists, etc.). */
  bodyHtml: string;
  /** Optional call-to-action button. */
  cta?: { label: string; url: string };
  /** Optional small note under the button (e.g. "This link expires in 7 days."). */
  footnote?: string;
  /** Sign-off line under the body. Defaults to the studio team; pass '' to omit. */
  signOff?: string;
}

/** Wrap body content in the Music & Life branded shell. Returns a full HTML doc. */
export function brandedEmail(opts: BrandedEmailOptions): string {
  const { previewText, heading, bodyHtml, cta, footnote } = opts;
  const signOff = opts.signOff ?? 'The Music &amp; Life team';

  const preview = previewText
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BRAND.paper}">${previewText}</div>`
    : '';

  const button = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:30px auto 6px"><tr><td style="border-radius:10px;background:${BRAND.pine}">
         <a href="${cta.url}" style="display:inline-block;padding:14px 34px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px">${cta.label}</a>
       </td></tr></table>`
    : '';

  const foot = footnote
    ? `<p style="margin:8px 0 0;text-align:center;font-family:${FONT};font-size:13px;line-height:20px;color:${BRAND.muted}">${footnote}</p>`
    : '';

  const signature = signOff
    ? `<p style="margin:28px 0 0;font-family:${FONT};font-size:15px;line-height:24px;color:${BRAND.ink}">Warmly,<br><strong style="color:${BRAND.pine}">${signOff}</strong></p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:${BRAND.paper}">
${preview}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.paper};padding:24px 12px">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${BRAND.line};border-radius:16px;overflow:hidden">
      <!-- header (real logo + note image swapped in at send time; text wordmark is the fallback) -->
      <tr><td align="center" style="background:${BRAND.paper};padding:30px 24px 26px;border-bottom:1px solid ${BRAND.line}">
        <span style="font-family:${SERIF};font-size:26px;font-weight:700;letter-spacing:1px;color:${BRAND.pine}">MUSIC &amp; LIFE</span>
        <span style="font-family:${SERIF};font-size:18px;color:${BRAND.pine}">&nbsp;&#9834;</span>
        <div style="margin-top:6px;font-family:${FONT};font-size:12px;font-weight:600;letter-spacing:4px;color:${BRAND.moss}">LONDON</div>
      </td></tr>
      <!-- card body -->
      <tr><td style="padding:34px 36px 30px">
        <h1 style="margin:0 0 16px;font-family:${FONT};font-size:24px;line-height:31px;font-weight:700;color:${BRAND.pine}">${heading}</h1>
        <div style="font-family:${FONT};font-size:15px;line-height:24px;color:${BRAND.ink}">${bodyHtml}</div>
        ${button}
        ${foot}
        ${signature}
      </td></tr>
      <!-- footer -->
      <tr><td align="center" style="background:${BRAND.paper};padding:24px 24px 26px;border-top:1px solid ${BRAND.line}">
        <p style="margin:0 0 6px;font-family:${FONT};font-size:13px;line-height:21px;color:${BRAND.muted}">
          &#9993;&nbsp; <a href="mailto:${BRAND.supportEmail}" style="color:${BRAND.moss};text-decoration:none">${BRAND.supportEmail}</a>
          &nbsp;&nbsp;&#9742;&nbsp; ${BRAND.phone}
        </p>
        <p style="margin:0 0 12px;font-family:${FONT};font-size:13px;line-height:21px;color:${BRAND.muted}">
          &#9679;&nbsp; ${BRAND.address}
        </p>
        <p style="margin:0;font-family:${FONT};font-size:12px;line-height:20px;color:${BRAND.muted}">
          <strong style="color:${BRAND.pine}">Music &amp; Life London</strong>
          &nbsp;&middot;&nbsp; <a href="${BRAND.website}" style="color:${BRAND.moss};text-decoration:none">musicandlife.co.uk</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/** A boxed key/value block (label left, emphasised value right) for the card body. */
export function detailsBlock(rows: { label: string; value: string }[]): string {
  const trs = rows
    .map(
      (r) => `<tr>
        <td style="padding:5px 0;font-family:${FONT};font-size:14px;color:${BRAND.muted}">${r.label}</td>
        <td style="padding:5px 0;font-family:${FONT};font-size:14px;font-weight:700;color:${BRAND.pine};text-align:right">${r.value}</td>
      </tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;background:${BRAND.panel};border-radius:12px">
    <tr><td style="padding:16px 20px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${trs}</table>
    </td></tr>
  </table>`;
}

/** Small helper: a boxed "your login details" block for the welcome email. */
export function loginDetailsBlock(email: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;background:${BRAND.panel};border-radius:12px">
    <tr><td style="padding:16px 20px;font-family:${FONT};font-size:14px;line-height:22px;color:${BRAND.ink}">
      <div style="color:${BRAND.muted};font-size:12px;text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px">Your portal login</div>
      <div><strong>Portal:</strong> <a href="${BRAND.portalUrl}" style="color:${BRAND.moss}">lirico.uk/login</a></div>
      <div><strong>Username:</strong> ${email}</div>
    </td></tr>
  </table>`;
}
