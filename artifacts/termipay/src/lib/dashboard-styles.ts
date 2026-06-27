export const DASHBOARD_STYLES = `
  @keyframes border-rotate {
    from { transform: rotate(360deg); }
    to   { transform: rotate(0deg);   }
  }
  @keyframes balance-pulse {
    0%   { transform: scale(1); }
    50%  { transform: scale(1.04); color: #34d399; }
    100% { transform: scale(1); }
  }
  @keyframes realtime-dot {
    0%, 100% { opacity: 1;   }
    50%       { opacity: 0.2; }
  }

  /* ── Hide scrollbar on all devices ── */
  * {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  *::-webkit-scrollbar {
    display: none;
  }
  html, body {
    overflow-x: hidden;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  html::-webkit-scrollbar,
  body::-webkit-scrollbar {
    display: none;
  }

  .rgb-container {
    position: relative;
    padding: 3px;
    border-radius: 23px;
    overflow: hidden;
    z-index: 0;
  }
  .rgb-container::before {
    content: '';
    position: absolute;
    width: 200%; height: 200%;
    background: conic-gradient(
      #ff0000, #ff7300, #fffb00, #48ff00,
      #00ffd5, #002bff, #7a00ff, #ff00c8, #ff0000
    );
    animation: border-rotate 4s linear infinite;
    z-index: -2;
    top: -50%; left: -50%;
  }
  .rgb-container::after {
    content: '';
    position: absolute;
    inset: 3px;
    background: rgba(15, 23, 42, 0.95);
    border-radius: 20px;
    z-index: -1;
  }

  .recaptcha-wrapper iframe { border-radius: 8px; }

  /* Blur everything behind the modal */
  .modal-open .dashboard-header,
  .modal-open .dashboard-content {
    filter: blur(8px) brightness(0.4);
    opacity: 0.6;
    pointer-events: none;
    user-select: none;
    transition: filter 0.35s ease, opacity 0.35s ease;
  }

  .balance-pulse { animation: balance-pulse 0.8s ease-in-out; }
  .realtime-dot  { animation: realtime-dot  1s  ease-in-out infinite; }

  .cancel-btn { color: #ffffff !important; }
  .cancel-btn:hover { color: #ffffff !important; }
  .cancel-btn:disabled { color: #ffffff !important; }
`;