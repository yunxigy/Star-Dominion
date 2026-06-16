export default function LoadingSpinner({ text = '加载中...' }: { text?: string }) {
  return (
    <div className="loading-spinner-wrap">
      <div className="loading-spinner" />
      <span className="loading-text">{text}</span>
      <style>{`
        .loading-spinner-wrap {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 40px;
          color: #888;
        }
        .loading-spinner {
          width: 20px;
          height: 20px;
          border: 2px solid #e0e0e0;
          border-top-color: #7c8aff;
          border-radius: 50%;
          animation: spin 0.6s linear infinite;
        }
        .loading-text {
          font-size: 14px;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
