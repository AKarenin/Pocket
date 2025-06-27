import React from 'react';
import ShareManager from './components/ShareManager';
import './styles.css';

const App: React.FC = () => {
  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <h1 className="app-title">
            <span className="icon">📂</span>
            Pocket File Sharing
          </h1>
          <div className="header-subtitle">
            Share folders locally with secure access
          </div>
        </div>
      </header>
      
      <main className="app-main">
        <ShareManager />
      </main>
      
      <footer className="app-footer">
        <div className="footer-content">
          <span>Local file sharing made simple</span>
        </div>
      </footer>
    </div>
  );
};

export default App; 