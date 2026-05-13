import { useState, useEffect } from 'react';
import PageView from '@telegraph/connection/application/browser/PageView';
import MonitorPage from '@telegraph/monitor/application/browser/MonitorPage';

import {
  CONNECTION_PAGE,
  ALL_PAGES,
  PageConfig,
} from '@telegraph/main/application/common/cp-config';
import {
  CONNECTION_PARTICIPANT_ID,
  MONITOR_PARTICIPANT_ID,
} from '@telegraph/pagelet-host/common';
import { SETTING_PARTICIPANT_ID } from '@telegraph/setting/application/common';

export type { PageConfig };

declare global {
  interface Window {
    electronAPI: {
      openSettingWindow: () => Promise<void>;
      onSwitchPage: (callback: (pageId: string) => void) => void;
    };
  }
}

function App(): JSX.Element {
  const [activePage, setActivePage] = useState<PageConfig>(CONNECTION_PAGE);

  useEffect(() => {
    window.electronAPI?.onSwitchPage((pageId: string) => {
      const page = ALL_PAGES.find((p) => p.id === pageId);
      if (page) setActivePage(page);
    });
  }, []);

  return (
    <div
      style={{
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        backgroundColor: '#f1f5f9',
        height: '100vh',
        display: 'flex',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: 200,
          backgroundColor: '#1e293b',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}
      >
        <div
          style={{ padding: '20px 16px', borderBottom: '1px solid #334155' }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: '#f8fafc',
              letterSpacing: -0.3,
            }}
          >
            Multi-Page (DI)
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
            Keep Alive + DI
          </div>
        </div>

        <div style={{ padding: '8px' }}>
          {ALL_PAGES.map((page) => (
            <button
              key={page.id}
              onClick={() => setActivePage(page)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                fontSize: 13,
                fontWeight: 600,
                border: 'none',
                borderRadius: 8,
                backgroundColor:
                  activePage.id === page.id ? `${page.color}25` : 'transparent',
                color: activePage.id === page.id ? page.color : '#94a3b8',
                cursor: 'pointer',
                marginBottom: 2,
                textAlign: 'left',
                transition: 'all 0.15s ease',
              }}
            >
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  backgroundColor:
                    activePage.id === page.id ? page.color : '#334155',
                  color: activePage.id === page.id ? '#fff' : '#94a3b8',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {page.id === 'connection' ? 'C' : 'M'}
              </span>
              <div>
                <div style={{ lineHeight: '16px' }}>{page.label}</div>
                <div
                  style={{
                    fontSize: 10,
                    color:
                      activePage.id === page.id ? `${page.color}99` : '#64748b',
                    lineHeight: '14px',
                  }}
                >
                  {page.description}
                </div>
              </div>
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ padding: '8px 8px 4px', borderTop: '1px solid #334155' }}>
          <button
            onClick={() => window.electronAPI?.openSettingWindow()}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              fontSize: 13,
              fontWeight: 600,
              border: 'none',
              borderRadius: 8,
              backgroundColor: 'transparent',
              color: '#94a3b8',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.15s ease',
            }}
            title="Open Settings Window"
          >
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                backgroundColor: '#334155',
                color: '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                flexShrink: 0,
              }}
            >
              ⚙
            </span>
            <span>Settings</span>
          </button>
        </div>

        <div style={{ padding: '8px 16px 12px' }}>
          <div
            style={{
              fontSize: 10,
              color: '#64748b',
              marginBottom: 6,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            Topology
          </div>
          <div
            style={{
              fontSize: 10,
              color: '#94a3b8',
              lineHeight: '16px',
              fontFamily: 'monospace',
            }}
          >
            renderer ↔ {CONNECTION_PARTICIPANT_ID}
            <br />
            {CONNECTION_PARTICIPANT_ID} ↔ shared
            <br />
            {CONNECTION_PARTICIPANT_ID} ↔ daemon
            <br />
            renderer ↔ main → {MONITOR_PARTICIPANT_ID}
            <br />
            {MONITOR_PARTICIPANT_ID} ↔ daemon
            <br />
            {SETTING_PARTICIPANT_ID} ↔ shared/daemon
          </div>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        {activePage.id === 'connection' ? (
          <PageView page={CONNECTION_PAGE} />
        ) : (
          <MonitorPage />
        )}
      </div>
    </div>
  );
}

export default App;
