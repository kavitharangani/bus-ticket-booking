function Wheel({ x }) {
  return (
    <g className="hero-wheel">
      <circle cx={x} cy="176" r="10" fill="#10242a" />
      <circle cx={x} cy="176" r="4.5" fill="#d9dfdc" />
      <path d={`M${x - 8} 176h16M${x} 168v16`} stroke="#8fa0a2" strokeWidth="1.5" />
    </g>
  )
}

function Cloud({ className, y, scale = 1 }) {
  return (
    <g className={className}>
      <g transform={`translate(0 ${y}) scale(${scale})`} fill="#ffffff" opacity="0.32">
        <ellipse cx="50" cy="20" rx="50" ry="14" />
        <ellipse cx="34" cy="12" rx="24" ry="12" />
        <ellipse cx="66" cy="9" rx="20" ry="11" />
      </g>
    </g>
  )
}

// Decoration only: hills at sunset, with a bus driving through them.
export default function HeroScene() {
  return (
    <svg className="hero-scene" viewBox="0 0 1200 220" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <circle className="hero-sun" cx="700" cy="112" r="62" fill="#ffd98a" opacity="0.35" />
      <circle cx="700" cy="112" r="40" fill="#ffe3a3" />
      <Cloud className="hero-cloud" y={30} />
      <Cloud className="hero-cloud hero-cloud-2" y={62} scale={0.7} />

      <path d="M0 132 C110 88 210 84 320 120 S520 158 640 112 860 72 980 110 1130 140 1200 104 V220 H0 Z" fill="#2f8a8c" />
      <path d="M0 158 C140 118 250 138 370 148 S590 112 730 138 960 164 1060 132 1160 128 1200 142 V220 H0 Z" fill="#1c6c67" />
      <path d="M0 168 C170 148 300 166 470 160 S780 146 930 164 1110 168 1200 156 V220 H0 Z" fill="#124f4d" />

      <rect y="172" width="1200" height="48" fill="#12262c" />
      <rect y="172" width="1200" height="2.5" fill="#f6ab2b" opacity="0.8" />
      <path className="hero-road-line" d="M0 197 H1200" stroke="#e7ecea" strokeWidth="3" strokeDasharray="34 30" opacity="0.7" />

      <g className="hero-bus">
        <ellipse cx="62" cy="187" rx="62" ry="4" fill="#000000" opacity="0.3" />
        <g className="hero-bus-body">
          <rect x="0" y="126" width="124" height="52" rx="9" fill="#d8432a" />
          <rect x="0" y="158" width="124" height="7" fill="#f6ab2b" />
          <rect x="8" y="134" width="20" height="17" rx="3" fill="#cfe9ec" />
          <rect x="32" y="134" width="20" height="17" rx="3" fill="#cfe9ec" />
          <rect x="56" y="134" width="20" height="17" rx="3" fill="#cfe9ec" />
          <rect x="80" y="134" width="14" height="30" rx="2" fill="#a9d3d8" />
          <path d="M98 134 H116 Q121 134 122 141 L124 152 H98 Z" fill="#cfe9ec" />
          <circle cx="121" cy="170" r="2.6" fill="#ffe9a8" />
        </g>
        <Wheel x={26} />
        <Wheel x={98} />
      </g>
    </svg>
  )
}
