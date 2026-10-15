import React from "react";
import { Link } from "react-router-dom";

export const Footer: React.FC = () => {
  return (
    <>
      <style>{`
        .dipkri-footer-wrapper {
          background: rgba(255, 255, 255, 0.02);
          border-top: 1px solid rgba(255, 255, 255, 0.06);
          padding: 18px 24px;
          padding-bottom: calc(18px + env(safe-area-inset-bottom, 0px));
          margin-top: auto;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 20px;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          box-sizing: border-box;
          width: 100%;
          position: relative;
          z-index: 10;
          flex-wrap: wrap;
        }

        .dipkri-footer-brand {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 13px;
          font-weight: 700;
          color: rgba(255, 255, 255, 0.4);
          letter-spacing: -0.2px;
        }

        .dipkri-footer-link {
          color: var(--text-muted, #6B7280);
          text-decoration: none;
          font-size: 12.5px;
          font-weight: 500;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          transition: color 200ms ease;
          display: inline-flex;
          align-items: center;
        }

        .dipkri-footer-link:hover {
          color: var(--accent-primary, #6366f1);
        }

        .dipkri-footer-dot {
          color: rgba(255, 255, 255, 0.15);
          user-select: none;
          display: inline-flex;
          align-items: center;
        }

        @media (max-width: 600px) {
          .dipkri-footer-wrapper {
            padding: 14px 16px;
            padding-bottom: calc(14px + env(safe-area-inset-bottom, 0px));
            gap: 14px;
          }

          .dipkri-footer-link {
            font-size: 11.5px;
          }
        }
      `}</style>
      <footer className="dipkri-footer-wrapper" role="contentinfo">
        <span className="dipkri-footer-brand">dipkri</span>
        <span className="dipkri-footer-dot" aria-hidden="true">
          ·
        </span>
        <Link to="/terms" className="dipkri-footer-link">
          Terms
        </Link>
        <span className="dipkri-footer-dot" aria-hidden="true">
          ·
        </span>
        <Link to="/privacy" className="dipkri-footer-link">
          Privacy
        </Link>
        <span className="dipkri-footer-dot" aria-hidden="true">
          ·
        </span>
        <Link to="/faq" className="dipkri-footer-link">
          FAQ
        </Link>
      </footer>
    </>
  );
};
