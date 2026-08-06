import { TEMPLATES } from '../src/notifications/notifications.service';

/**
 * The broadcast body is escaped before it reaches the branded email template
 * (broadcastBodyToHtml), but the SUBJECT line — free text from the same
 * compose box — was dropped straight into the HTML heading unescaped. A
 * manager broadcasting to "everyone" could put markup in the subject and have
 * it render as live HTML for every family/teacher/student who received it.
 */

describe('newsletter.event template — subject escaping', () => {
  it('escapes markup in the subject before it becomes the HTML heading', () => {
    const { html } = TEMPLATES['newsletter.event']!({
      orgId: 'org-1',
      body: '<p>hi</p>',
      subject: '<img src=x onerror=alert(1)>',
    });

    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('leaves an ordinary subject untouched', () => {
    const { html, subject } = TEMPLATES['newsletter.event']!({
      orgId: 'org-1',
      body: '<p>hi</p>',
      subject: 'Half-term recital & schedule',
    });

    expect(subject).toBe('Half-term recital & schedule');
    expect(html).toContain('Half-term recital &amp; schedule');
  });
});
