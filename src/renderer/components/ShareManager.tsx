import React, { useState, useEffect } from 'react';
import { Share, TunnelStatus } from '../../types';

const ShareManager: React.FC = () => {
  const [shares, setShares] = useState<Share[]>([]);
  const [tunnelStatus, setTunnelStatus] = useState<TunnelStatus>({ isRunning: false });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadShares();
    loadTunnelStatus();
    
    const interval = setInterval(loadTunnelStatus, 5000); // Check tunnel status every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const loadShares = async () => {
    try {
      const sharesData = await window.electronAPI.getShares();
      setShares(sharesData);
    } catch (error) {
      console.error('Failed to load shares:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadTunnelStatus = async () => {
    try {
      const status = await window.electronAPI.getTunnelStatus();
      setTunnelStatus(status);
    } catch (error) {
      console.error('Failed to load tunnel status:', error);
    }
  };

  const handleAddFolder = async () => {
    try {
      const folderPath = await window.electronAPI.selectFolder();
      if (folderPath) {
        const result = await window.electronAPI.createShare(folderPath);
        await loadShares(); // Reload to show new share
        
        alert(`Share created!\nShare ID: ${result.shareId}\nPasscode: ${result.passcode}\nURL: https://${result.shareId}.pocketfileshare.com`);
      }
    } catch (error) {
      console.error('Failed to create share:', error);
      alert('Failed to create share');
    }
  };

  const handleStartShare = async (shareId: string) => {
    try {
      await window.electronAPI.startShare(shareId);
      await loadShares();
    } catch (error) {
      console.error('Failed to start share:', error);
      alert('Failed to start share');
    }
  };

  const handleStopShare = async (shareId: string) => {
    try {
      await window.electronAPI.stopShare(shareId);
      await loadShares();
    } catch (error) {
      console.error('Failed to stop share:', error);
      alert('Failed to stop share');
    }
  };

  const handleDeleteShare = async (shareId: string) => {
    if (confirm('Are you sure you want to delete this share?')) {
      try {
        await window.electronAPI.deleteShare(shareId);
        await loadShares();
      } catch (error) {
        console.error('Failed to delete share:', error);
        alert('Failed to delete share');
      }
    }
  };

  const copyShareInfo = (share: Share) => {
    const info = `Share URL: https://${share.id}.pocketfileshare.com\nPasscode: ${share.passcode}`;
    navigator.clipboard.writeText(info);
    alert('Share info copied to clipboard!');
  };

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString();
  };

  const getTunnelStatusColor = () => {
    if (tunnelStatus.isRunning) return 'text-green-500';
    if (tunnelStatus.error) return 'text-red-500';
    return 'text-yellow-500';
  };

  const getTunnelStatusText = () => {
    if (tunnelStatus.isRunning) return 'Online';
    if (tunnelStatus.error) return `Offline (${tunnelStatus.error})`;
    return 'Offline';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">📁 Pocket File Sharing</h1>
        <p className="text-gray-600">Share files securely with Cloudflare tunnels</p>
      </div>

      {/* Tunnel Status */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">🌐 Tunnel Status</h2>
        <div className="flex items-center space-x-2">
          <span className="text-gray-700">Status:</span>
          <span className={`font-semibold ${getTunnelStatusColor()}`}>
            {getTunnelStatusText()}
          </span>
        </div>
        {tunnelStatus.isRunning && (
          <p className="text-sm text-gray-600 mt-2">
            Shares are accessible globally via https://*.pocketfileshare.com
          </p>
        )}
        {!tunnelStatus.isRunning && !tunnelStatus.error && (
          <p className="text-sm text-gray-600 mt-2">
            Shares are only accessible locally
          </p>
        )}
      </div>

      {/* Add Share Button */}
      <div className="mb-6">
        <button
          onClick={handleAddFolder}
          className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-lg font-medium"
        >
          📤 Add Folder to Share
        </button>
      </div>

      {/* Shares List */}
      <div className="bg-white rounded-lg shadow-md">
        <div className="p-6 border-b">
          <h2 className="text-xl font-semibold">📂 Active Shares ({shares.length})</h2>
        </div>

        {shares.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            <p>No shares created yet.</p>
            <p className="text-sm mt-2">Click "Add Folder to Share" to get started.</p>
          </div>
        ) : (
          <div className="divide-y">
            {shares.map((share) => (
              <div key={share.id} className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <h3 className="font-medium text-gray-800">
                        📁 {share.path.split('/').pop() || share.path}
                      </h3>
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          share.status === 'active'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {share.status}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600 space-y-1">
                      <p>Path: {share.path}</p>
                      <p>Share ID: {share.id}</p>
                      <p>Passcode: {share.passcode}</p>
                      <p>Created: {formatDate(share.createdAt)}</p>
                      {share.lastAccessed && (
                        <p>Last accessed: {formatDate(share.lastAccessed)}</p>
                      )}
                      {tunnelStatus.isRunning && (
                        <p>Public URL: https://{share.id}.pocketfileshare.com</p>
                      )}
                      <p>Local URL: http://localhost:{share.port}</p>
                    </div>
                  </div>

                  <div className="flex space-x-2">
                    {share.status === 'inactive' ? (
                      <button
                        onClick={() => handleStartShare(share.id)}
                        className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded"
                      >
                        ▶️ Start
                      </button>
                    ) : (
                      <button
                        onClick={() => handleStopShare(share.id)}
                        className="bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded"
                      >
                        ⏸️ Stop
                      </button>
                    )}
                    
                    <button
                      onClick={() => copyShareInfo(share)}
                      className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded"
                    >
                      📋 Copy
                    </button>
                    
                    {tunnelStatus.isRunning && share.status === 'active' && (
                      <button
                        onClick={() => window.open(`https://${share.id}.pocketfileshare.com`, '_blank')}
                        className="bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded"
                      >
                        🌐 Open
                      </button>
                    )}
                    
                    {share.status === 'active' && (
                      <button
                        onClick={() => window.open(`http://localhost:${share.port}`, '_blank')}
                        className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded"
                      >
                        🏠 Local
                      </button>
                    )}
                    
                    <button
                      onClick={() => handleDeleteShare(share.id)}
                      className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded"
                    >
                      🗑️ Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ShareManager; 