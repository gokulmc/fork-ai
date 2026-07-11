import { ImageResponse } from 'next/og';
import { LOGO_DATA_URL } from './og-logo';

// Shared 1200×630 social card. Palette + layout mirror the OTP verification
// email (infra/lambda/cognito-custom-email/index.js) so share previews and
// transactional mail look like one brand. Reused by the homepage OG and every
// blog post's per-post OG.
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export const OG_BG = '#f5f5f4';
export const OG_CARD = '#ffffff';
export const OG_BORDER = '#e7e5e4';
export const OG_INK = '#1c1917';
export const OG_SUB = '#78716c';
export const OG_MUTED = '#a8a29e';
export const OG_PANEL = '#fafaf9';
export const OG_DIVIDER = '#f0efee';

const BG = OG_BG, CARD = OG_CARD, BORDER = OG_BORDER, INK = OG_INK;
const SUB = OG_SUB, MUTED = OG_MUTED, PANEL = OG_PANEL, DIVIDER = OG_DIVIDER;

function logo(): string {
  return LOGO_DATA_URL;
}

export function brandCard({
  eyebrow, title, subtitle, headers,
}: { eyebrow?: string; title: string; subtitle?: string; headers?: Record<string, string> }) {
  // Scale the headline down for longer (blog) titles so they fit the card.
  const titleSize = title.length > 70 ? 42 : title.length > 45 ? 50 : 62;
  return new ImageResponse(
    (
      <div style={{ display: 'flex', width: '100%', height: '100%', background: BG, padding: 64 }}>
        <div
          style={{
            display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
            background: CARD, border: `1px solid ${BORDER}`, borderRadius: 28, overflow: 'hidden',
          }}
        >
          {/* Header — logo + wordmark, matching the email header */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '40px 56px', borderBottom: `1px solid ${DIVIDER}` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo()} width={56} height={56} style={{ borderRadius: 12 }} alt="" />
            <div style={{ marginLeft: 18, fontSize: 34, fontWeight: 700, color: INK, letterSpacing: -1 }}>fork ai</div>
          </div>

          {/* Body */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center', padding: '0 56px' }}>
            {eyebrow ? (
              <div style={{ display: 'flex', fontSize: 21, color: MUTED, letterSpacing: 4, textTransform: 'uppercase', marginBottom: 22 }}>
                {eyebrow}
              </div>
            ) : null}
            <div style={{ display: 'flex', fontSize: titleSize, fontWeight: 600, color: INK, letterSpacing: -1.5, lineHeight: 1.12 }}>
              {title}
            </div>
            {subtitle ? (
              <div style={{ display: 'flex', fontSize: 29, color: SUB, marginTop: 26, lineHeight: 1.4 }}>{subtitle}</div>
            ) : null}
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '26px 56px', background: PANEL, borderTop: `1px solid ${DIVIDER}`, fontSize: 22, color: MUTED }}>
            forkai.in
          </div>
        </div>
      </div>
    ),
    { ...size, ...(headers ? { headers } : {}) },
  );
}
