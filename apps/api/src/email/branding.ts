/**
 * Shared branded HTML layout for all outbound Music & Life emails.
 *
 * Email clients strip <style> and external CSS unpredictably, so everything
 * here is table-based with inline styles and web-safe font fallbacks. Keep it
 * single-column and <=600px so it renders well on mobile and in Gmail/Outlook.
 */

export const BRAND = {
  name: 'Music & Life',
  portalUrl: 'https://lirico.uk/login',
  website: 'https://www.musicandlife.co.uk',
  supportEmail: 'office@musicandlife.co.uk',
  phone: '+44 7848 115 447',
  address: '10 High Street, Pinner HA5 5PW',
  // Colours
  ink: '#241c2e',
  plum: '#4c2a63',
  accent: '#c9426b',
  paper: '#faf7fb',
  line: '#e7e0ec',
  muted: '#6b6675',
} as const;

const FONT = "'Lexend', 'Helvetica Neue', Helvetica, Arial, sans-serif";

export interface BrandedEmailOptions {
  /** Hidden preview/snippet text shown in the inbox list. */
  previewText?: string;
  /** Big heading at the top of the card. */
  heading: string;
  /** Main body — already-escaped HTML (paragraphs, lists, etc.). */
  bodyHtml: string;
  /** Optional call-to-action button. */
  cta?: { label: string; url: string };
  /** Optional small note under the body (e.g. "Reply to this email …"). */
  footnote?: string;
}

/** Wrap body content in the Music & Life branded shell. Returns a full HTML doc. */
export function brandedEmail(opts: BrandedEmailOptions): string {
  const { previewText, heading, bodyHtml, cta, footnote } = opts;

  const preview = previewText
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BRAND.paper}">${previewText}</div>`
    : '';

  const button = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px"><tr><td style="border-radius:10px;background:${BRAND.accent}">
         <a href="${cta.url}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px">${cta.label}</a>
       </td></tr></table>`
    : '';

  const foot = footnote
    ? `<p style="margin:20px 0 0;font-family:${FONT};font-size:13px;line-height:20px;color:${BRAND.muted}">${footnote}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:${BRAND.paper}">
${preview}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.paper};padding:24px 12px">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
      <!-- header -->
      <tr><td style="padding:8px 8px 20px">
        <span style="font-family:${FONT};font-size:20px;font-weight:700;letter-spacing:.2px;color:${BRAND.plum}">&#9834; Music &amp; Life</span>
      </td></tr>
      <!-- card -->
      <tr><td style="background:#ffffff;border:1px solid ${BRAND.line};border-radius:16px;padding:34px 34px 30px">
        <h1 style="margin:0 0 14px;font-family:${FONT};font-size:23px;line-height:30px;font-weight:700;color:${BRAND.ink}">${heading}</h1>
        <div style="font-family:${FONT};font-size:15px;line-height:24px;color:${BRAND.ink}">${bodyHtml}</div>
        ${button}
        ${foot}
      </td></tr>
      <!-- footer -->
      <tr><td style="padding:22px 8px 8px">
        <p style="margin:0 0 6px;font-family:${FONT};font-size:13px;line-height:20px;color:${BRAND.muted}">
          <strong style="color:${BRAND.plum}">Music &amp; Life</strong> &middot; ${BRAND.address}
        </p>
        <p style="margin:0;font-family:${FONT};font-size:13px;line-height:20px;color:${BRAND.muted}">
          <a href="mailto:${BRAND.supportEmail}" style="color:${BRAND.muted}">${BRAND.supportEmail}</a>
          &nbsp;&middot;&nbsp; ${BRAND.phone}
          &nbsp;&middot;&nbsp; <a href="${BRAND.website}" style="color:${BRAND.muted}">musicandlife.co.uk</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/** Small helper: a boxed "your login details" block for the welcome email. */
export function loginDetailsBlock(email: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 4px;background:${BRAND.paper};border:1px solid ${BRAND.line};border-radius:12px">
    <tr><td style="padding:16px 18px;font-family:${FONT};font-size:14px;line-height:22px;color:${BRAND.ink}">
      <div style="color:${BRAND.muted};font-size:12px;text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px">Your portal login</div>
      <div><strong>Portal:</strong> <a href="${BRAND.portalUrl}" style="color:${BRAND.accent}">lirico.uk/login</a></div>
      <div><strong>Username:</strong> ${email}</div>
    </td></tr>
  </table>`;
}
