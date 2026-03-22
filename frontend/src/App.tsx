import { useState, useEffect, useRef } from 'react';
import io, { Socket } from 'socket.io-client';
import { Terminal, Send, Activity, Wallet, Cpu, CheckCircle } from 'lucide-react';
import './App.css';

interface AgentLog {
  message: string;
  type: 'thought' | 'action' | 'observation' | 'system' | 'error' | 'success';
  timestamp: number;
}

function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [address, setAddress] = useState('0x...');
  const [balance, setBalance] = useState('0.00');
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [prompt, setPrompt] = useState('Revisa el marketplace y cómprame datos de Oro (XAU) si cuestan menos de 0.20 USDt.');
  const [isProcessing, setIsProcessing] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Connect to the Express/Node.js backend running on port 3000
    const newSocket = io('http://localhost:3000');
    setSocket(newSocket);

    newSocket.on('connect', () => {
      setIsConnected(true);
      setLogs(prev => [...prev, { message: 'Conectado al Cerebro A.T.L.A.S.', type: 'system', timestamp: Date.now() }]);
    });

    newSocket.on('disconnect', () => {
      setIsConnected(false);
      setLogs(prev => [...prev, { message: 'Desconectado del servidor.', type: 'error', timestamp: Date.now() }]);
    });

    newSocket.on('wallet_status', (data) => {
      setAddress(data.address);
      setBalance(data.balance.toString().split(' ')[0]); // "0.10 USDt" -> "0.10"
    });

    newSocket.on('agent_log', (data) => {
      setLogs(prev => [...prev, { message: data.text, type: data.type, timestamp: data.timestamp }]);
      // If we see a success final message or error, we can re-enable the button
      if (data.type === 'success' || data.type === 'error') {
        if (data.text.includes("RESPUESTA FINAL") || data.type === 'error') {
          setIsProcessing(false);
        }
      }
    });

    // Refresh wallet balance every 5 seconds via REST API
    const interval = setInterval(async () => {
      try {
        const res = await fetch('http://localhost:3000/api/status');
        const data = await res.json();
        setBalance(data.balance.toString().split(' ')[0]);
      } catch (e) {
        // Ignore fetch errors if backend is down
      }
    }, 5000);

    return () => {
      newSocket.close();
      clearInterval(interval);
    };
  }, []);

  // Auto-scroll to bottom of logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleRunMission = () => {
    if (!socket || !prompt.trim()) return;
    setIsProcessing(true);
    setLogs([]); // Clear previous mission logs
    socket.emit('start_mission', { prompt });
  };

  return (
    <div className="dashboard">
      <header className="header">
        <div className="logo">
          <Cpu size={32} color="var(--accent-color)" />
          A.T.L.A.S
        </div>
        <div className="status-badge">
          <div className="status-dot" style={{ background: isConnected ? 'var(--accent-color)' : 'var(--danger)' }}></div>
          {isConnected ? 'NODE ONLINE' : 'OFFLINE'}
        </div>
      </header>

      <div className="sidebar">
        <div className="glass-panel wallet-card">
          <div className="wallet-label">Smart Account (ERC-4337)</div>
          <div className="wallet-address">{address}</div>
          <div className="wallet-label">Available Liquidity</div>
          <div className="balance-box">
            <span className="balance-amount">{balance}</span>
            <span className="balance-currency">USDt</span>
          </div>
        </div>

        <div className="glass-panel mission-control">
          <h3>Mission Control</h3>
          <div className="input-group">
            <textarea 
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Escribe el objetivo del agente aquí..."
              disabled={isProcessing || !isConnected}
            />
            <button 
              onClick={handleRunMission}
              disabled={isProcessing || !isConnected || !prompt.trim()}
            >
              <Send size={18} />
              {isProcessing ? 'Agent Running...' : 'Deploy Agent'}
            </button>
          </div>
        </div>
      </div>

      <div className="glass-panel terminal-panel">
        <div className="terminal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)' }}>
            <Terminal size={18} />
            <span>Agentic Reasoning Core</span>
          </div>
          {isProcessing && <Activity size={18} color="var(--accent-color)" className="spin" />}
        </div>
        
        <div className="terminal-logs">
          {logs.map((log, index) => (
            <div key={index} className={`log-entry log-${log.type}`}>
               {log.message}
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
}

export default App;
