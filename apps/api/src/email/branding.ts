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
  // The real wordmark, served from the portal's public folder. Emails can't use
  // a bundled asset, so this has to be an absolute URL on a host that's up.
  logoUrl: 'https://lirico.uk/logo-full-transparent.png',
  website: 'https://www.musicandlife.co.uk',
  supportEmail: 'academy@musicandlife.co.uk',
  phone: '+44 7848 115 447',
  address: '10 High Street, Pinner HA5 5PW',
  // Colours
  pine: '#1e3a2e',   // brand wordmark, headings, primary button, emphasised values
  moss: '#2f6a4d',   // links
  ink: '#33372f',    // body copy
  paper: '#f6f4ec',  // page background (warm cream)
  panel: '#f1efe6',  // detail block background
  line: '#e5e2d5',   // hairline borders
  muted: '#8a887c',  // labels, fine print
  // Footer background — a warm sage wash, mixed toward the same cream/beige
  // family as `paper`/`panel` rather than a cool minty green, so it sits
  // alongside the rest of the email instead of clashing with it.
  sageLt: '#e9ede0',
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
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">
<!-- Best-effort custom font: Gmail webmail and Apple/iOS Mail load this; clients
     that don't (Outlook desktop, most Android mail apps) silently fall through
     to the Helvetica/Arial stack in FONT below, so this is additive, not required. -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lexend:wght@400;600;700&display=swap" rel="stylesheet">
<!--[if mso]><style>table,td{border-collapse:collapse}</style><![endif]--></head>
<body style="margin:0;padding:0;background:${BRAND.paper}">
${preview}
<!-- Full-width background row. text-align:center centres the card in clients
     that honour it; align="center" on the inner table and margin:0 auto below
     are backstops for the ones that don't (Gmail web, some Outlooks). -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.paper};padding:24px 12px;text-align:center">
  <tr><td align="center" style="text-align:center">
    <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" align="center"><tr><td><![endif]-->
    <table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;margin:0 auto;background:#ffffff;border:1px solid ${BRAND.line};border-radius:16px;overflow:hidden;text-align:left">
      <!-- header: the real wordmark, centred. The alt text carries the studio
           name for the many clients that block images by default. -->
      <tr><td align="center" style="background:#ffffff;padding:30px 24px 22px;text-align:center">
        <img src="${BRAND.logoUrl}" width="260" alt="Music &amp; Life London"
             style="display:block;margin:0 auto;width:260px;max-width:70%;height:auto;border:0;outline:none;text-decoration:none" />
      </td></tr>
      <!-- green rule under the wordmark -->
      <tr><td style="padding:0 36px"><div style="height:3px;background:${BRAND.pine};border-radius:2px"></div></td></tr>
      <!-- card body -->
      <tr><td style="padding:34px 36px 30px">
        <h1 style="margin:0 0 18px;font-family:${FONT};font-size:24px;line-height:31px;font-weight:700;color:${BRAND.pine};text-align:center">${heading}</h1>
        <div style="font-family:${FONT};font-size:15px;line-height:24px;color:${BRAND.ink}">${bodyHtml}</div>
        ${button}
        ${foot}
        ${signature}
      </td></tr>
      <!-- hairline rule separating body from footer -->
      <tr><td style="padding:0 36px"><div style="height:1px;background:${BRAND.line}"></div></td></tr>
      <!-- footer: a soft sage-green wash (matches the portal's own light-sage
           tint) instead of a solid dark block, with pine text/links — same
           brand, lighter close to the page. -->
      <tr><td align="center" style="background:${BRAND.sageLt};padding:22px 24px 26px;text-align:center">
        <p style="margin:0 0 8px;font-family:${FONT};font-size:14px;line-height:20px;font-weight:700;letter-spacing:.3px;color:${BRAND.pine}">
          Music &amp; Life London
        </p>
        <p style="margin:0 0 2px;font-family:${FONT};font-size:12.5px;line-height:20px;color:${BRAND.muted}">
          <a href="mailto:${BRAND.supportEmail}" style="color:${BRAND.moss};text-decoration:none">${BRAND.supportEmail}</a>
        </p>
        <p style="margin:0 0 6px;font-family:${FONT};font-size:12.5px;line-height:20px;color:${BRAND.muted};white-space:nowrap">
          ${BRAND.phone}
        </p>
        <p style="margin:0 0 10px;font-family:${FONT};font-size:12.5px;line-height:20px;color:${BRAND.muted}">
          ${BRAND.address}
        </p>
        <p style="margin:0;font-family:${FONT};font-size:11.5px;line-height:19px">
          <a href="${BRAND.website}" style="color:${BRAND.moss};text-decoration:underline">musicandlife.co.uk</a>
          &nbsp;&middot;&nbsp;
          <a href="${BRAND.portalUrl}" style="color:${BRAND.moss};text-decoration:underline">Your portal</a>
        </p>
      </td></tr>
    </table>
    <!--[if mso]></td></tr></table><![endif]-->
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
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;background:${BRAND.panel};border-left:3px solid ${BRAND.pine};border-radius:12px">
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
