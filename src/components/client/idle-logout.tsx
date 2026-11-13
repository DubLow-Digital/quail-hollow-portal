'use client';

import { useEffect, useRef } from 'react';

const IDLE_MS = 30 * 60 * 1000;
export const ACTIVITY_EVENT = 'qh:activity';

/**
 * Signs the client out after 30 minutes without interaction, so the page does not keep
 * showing their information on a shared or unattended device. The server enforces the
 * same limit independently. Uploads in progress dispatch ACTIVITY_EVENT to stay signed in.
 */
export function IdleLogout() {
  const lastActivity = useRef(0);

  useEffect(() => {
    lastActivity.current = Date.now();
    const bump = () => {
      lastActivity.current = Date.now();
    };
    const events = ['pointerdown', 'keydown', 'touchstart', 'scroll', ACTIVITY_EVENT] as const;
    for (const e of events) window.addEventListener(e, bump, { passive: true });

    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity.current < IDLE_MS) return;
      window.clearInterval(timer);
      const form = document.createElement('form');
      form.method = 'post';
      form.action = '/api/auth/logout?reason=idle';
      document.body.appendChild(form);
      form.submit();
    }, 30_000);

    return () => {
      for (const e of events) window.removeEventListener(e, bump);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
