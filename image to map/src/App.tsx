import React, { useState } from 'react';
import SmartImageQuantizer from './SmartImageQuantizer';
import ImageToMapConverter from './ImageToMapConverter';

export default function App() {
  const [activeTab, setActiveTab] = useState<'quantizer' | 'map'>('quantizer');

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Top Navigation Bar */}
      <nav className="border-b border-gray-800 bg-gray-900/80 backdrop-blur sticky top-0 z-50 px-6 py-3">
        <div className="max-w-6xl mx-auto flex gap-4">
          <button
            onClick={() => setActiveTab('quantizer')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'quantizer'
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            Smart Image Quantizer
          </button>
          <button
            onClick={() => setActiveTab('map')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'map'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            Image to Map Converter
          </button>
        </div>
      </nav>

      {/* Main Viewport */}
      <main>
        {activeTab === 'quantizer' ? <SmartImageQuantizer /> : <ImageToMapConverter />}
      </main>
    </div>
  );
}