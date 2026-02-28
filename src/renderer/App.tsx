import { MemoryRouter as Router, Routes, Route } from 'react-router-dom';
import { useState } from 'react';
import './App.css';

type RecentFolder = {
  name: string;
  path: string;
};

const getFolderName = (folderPath: string): string => {
  return (
    folderPath
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || 'Workspace'
  );
};

function Home() {
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [recentFolders, setRecentFolders] = useState<RecentFolder[]>([]);
  const [isSelecting, setIsSelecting] = useState(false);

  const handleFolderSelect = async () => {
    setIsSelecting(true);

    try {
      const selectedFolder = await window.electron.folder.select();

      if (!selectedFolder) {
        return;
      }

      setActiveFolder(selectedFolder);
      setRecentFolders((previous) => {
        const updated = previous.filter(
          (folder) => folder.path !== selectedFolder,
        );
        updated.unshift({
          name: getFolderName(selectedFolder),
          path: selectedFolder,
        });
        return updated.slice(0, 4);
      });
    } finally {
      setIsSelecting(false);
    }
  };

  return (
    <main className="home-screen">
      <div className="atmosphere" aria-hidden="true" />
      <section className="portal-card">
        <div className="glyph" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>

        <h1>Select a Folder</h1>
        <p className="subtitle">Choose a workspace to launch your flow.</p>

        <button
          type="button"
          className="pick-button"
          onClick={handleFolderSelect}
          disabled={isSelecting}
        >
          {isSelecting ? 'Opening picker...' : 'Choose Folder'}
        </button>

        <section className="current-folder" aria-live="polite">
          <p className="eyebrow">Current Workspace</p>
          <p className="folder-name">
            {activeFolder ? getFolderName(activeFolder) : 'No folder selected'}
          </p>
          <p className="folder-path">
            {activeFolder || 'Select a folder to begin'}
          </p>
        </section>

        {recentFolders.length > 0 && (
          <section className="recent-section">
            <p className="eyebrow">Recent Picks</p>
            <ul className="recent-folders">
              {recentFolders.map((folder, index) => (
                <li
                  key={folder.path}
                  style={{ animationDelay: `${140 + index * 70}ms` }}
                >
                  <button
                    type="button"
                    className="recent-folder-button"
                    onClick={() => setActiveFolder(folder.path)}
                  >
                    <span>{folder.name}</span>
                    <small>{folder.path}</small>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </section>
    </main>
  );
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </Router>
  );
}
