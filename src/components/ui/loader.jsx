import React from "react";

export const ChemicalBeakerLoader = ({ className }) => {
  return (
    <div className={`relative w-24 h-32 mx-auto ${className}`}>
      {/* Beaker Body */}
      <div className="absolute inset-0 border-4 border-slate-300 rounded-b-3xl rounded-t-md bg-white/30 backdrop-blur-sm overflow-hidden z-10">
        
        {/* Measurement Lines */}
        <div className="absolute top-1/4 left-2 right-2 h-0.5 bg-slate-200/50 w-4"></div>
        <div className="absolute top-2/4 left-2 right-2 h-0.5 bg-slate-200/50 w-6"></div>
        <div className="absolute top-3/4 left-2 right-2 h-0.5 bg-slate-200/50 w-4"></div>

        {/* Liquid */}
        <div className="absolute bottom-0 left-0 right-0 h-full bg-gradient-to-t from-cyan-500 via-blue-500 to-purple-500 opacity-80 animate-[fill-up_2s_ease-in-out_infinite_alternate]" style={{ transformOrigin: 'bottom' }}>
          {/* Bubbles */}
          <div className="absolute bottom-2 left-1/4 w-2 h-2 bg-white rounded-full animate-[bubble-rise_1.5s_ease-in_infinite]"></div>
          <div className="absolute bottom-4 left-1/2 w-3 h-3 bg-white rounded-full animate-[bubble-rise_2s_ease-in_infinite_0.5s]"></div>
          <div className="absolute bottom-3 left-3/4 w-1.5 h-1.5 bg-white rounded-full animate-[bubble-rise_1.2s_ease-in_infinite_0.8s]"></div>
        </div>
        
        {/* Surface Tension/Highlight */}
        <div className="absolute top-0 left-0 right-0 h-4 bg-white/20 rounded-full blur-[2px]"></div>
      </div>
      
      {/* Lip of beaker */}
      <div className="absolute -top-1 left-[-2px] right-[-2px] h-2 bg-slate-300 rounded-full z-20"></div>
    </div>
  );
};
