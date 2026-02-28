import Game from './components/Game.tsx';

import { ToastContainer } from 'react-toastify';
import helpImg from '../assets/help.svg';
import { useState } from 'react';
import ReactModal from 'react-modal';
import Button from './components/buttons/Button.tsx';
import FreezeButton from './components/FreezeButton.tsx';

export default function Home() {
  const [helpModalOpen, setHelpModalOpen] = useState(false);
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-between font-body game-background">
      <ReactModal
        isOpen={helpModalOpen}
        onRequestClose={() => setHelpModalOpen(false)}
        style={modalStyles}
        contentLabel="Help modal"
        ariaHideApp={false}
      >
        <div className="font-body">
          <h1 className="text-center text-6xl font-bold font-display game-title">Help</h1>
          <p>
            Welcome to the LLM Life Simulator. AI agents with psyche-driven behavior live, interact,
            and develop in a small world. You observe — you don't direct.
          </p>
          <h2 className="text-4xl mt-4">Observing</h2>
          <p>
            Click and drag to move around the world, and scroll in and out to zoom. You can click on
            an individual agent to view their needs, current activity, and conversation history.
          </p>
        </div>
      </ReactModal>

      <div className="w-full h-screen relative isolate overflow-hidden flex flex-col">
        {/* Compact header */}
        <div className="flex items-center gap-4 px-4 py-2 shrink-0">
          <h1 className="text-2xl font-bold font-display leading-none tracking-wide game-title">
            Life Sim
          </h1>
          <span className="text-sm text-white/70 hidden sm:block">
            AI agents with psyche-driven behavior, living their lives.
          </span>
          <div className="ml-auto flex gap-2 pointer-events-auto">
            <FreezeButton />
            <Button imgUrl={helpImg} onClick={() => setHelpModalOpen(true)}>
              Help
            </Button>
          </div>
        </div>

        {/* Game fills all remaining space */}
        <div className="flex-1 min-h-0">
          <Game />
        </div>

        <ToastContainer position="bottom-right" autoClose={2000} closeOnClick theme="dark" />
      </div>
    </main>
  );
}

const modalStyles = {
  overlay: {
    backgroundColor: 'rgb(0, 0, 0, 75%)',
    zIndex: 12,
  },
  content: {
    top: '50%',
    left: '50%',
    right: 'auto',
    bottom: 'auto',
    marginRight: '-50%',
    transform: 'translate(-50%, -50%)',
    maxWidth: '50%',

    border: '10px solid rgb(23, 20, 33)',
    borderRadius: '0',
    background: 'rgb(35, 38, 58)',
    color: 'white',
    fontFamily: '"Upheaval Pro", "sans-serif"',
  },
};
