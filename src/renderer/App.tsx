import { MemoryRouter as Router, Routes, Route } from 'react-router-dom';
import { useState } from 'react';
import './App.css';

function Home() {
  const [count, setCount] = useState(0);

  return (
    <main className="app">
      <h1>Timefold Desktop</h1>
      <p>A simple Electron + React starter app.</p>
      <div className="counter">{count}</div>
      <div className="actions">
        <button type="button" onClick={() => setCount((value) => value + 1)}>
          Increment
        </button>
        <button type="button" onClick={() => setCount(0)}>
          Reset
        </button>
      </div>
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
