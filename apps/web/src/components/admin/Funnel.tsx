'use client';

import { useEffect, useState } from 'react';
import { adminApi, type FunnelMetrics } from '@/lib/api';
import { FunnelChart, type FunnelStage } from './charts';

const COLORS = ['#38bdf8', '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#22c55e'];

export function Funnel({ idToken }: { idToken: string }) {
  const [m, setM] = useState<FunnelMetrics | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    adminApi.getFunnel(idToken).then(setM).catch((e) => setErr(String(e)));
  }, [idToken]);

  if (err) return <div className="ad-card ad-err">{err}</div>;
  if (!m) return <div className="ad-empty">Loading funnel…</div>;

  const stages: FunnelStage[] = [
    { label: 'Views', value: m.views, color: COLORS[0] },
    { label: 'First query', value: m.firstQuery, color: COLORS[1] },
    { label: 'Account', value: m.accounts, color: COLORS[2] },
    { label: 'Share / Notion', value: m.shareOrNotion, color: COLORS[3] },
    { label: 'Recharge', value: m.recharges, color: COLORS[4] },
    { label: 'Referral', value: m.referrals, color: COLORS[5] },
  ];

  return (
    <div className="ad-grid-main">
      <div className="ad-card">
        <div className="ad-card-head"><h3>Conversion funnel</h3></div>
        <p className="ad-muted" style={{ marginTop: 0 }}>
          Independent stage counts, not a strict per-visitor cohort — a user can appear in a later
          stage without having appeared in an earlier one.
        </p>
        <FunnelChart stages={stages} />
      </div>
    </div>
  );
}
