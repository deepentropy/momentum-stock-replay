// initialisation du chart (dark theme)
const chart = LightweightCharts.createChart(
  document.getElementById('container'),
  {
    layout: {
      background: { color: '#222' },
      textColor:  '#DDD',
    },
    grid: {
      vertLines: { color: '#444' },
      horzLines: { color: '#444' },
    },
    leftPriceScale:  { borderColor: '#555' },
    rightPriceScale: { borderColor: '#555' },
    timeScale: {
      borderColor:    '#555',
      timeVisible:    true,
      secondsVisible: true,
      timePrecision:  'second',
      tickMarkFormatter: t => {
        const d = new Date(t * 1000);
        return d.toLocaleTimeString('fr-FR', { hour12: false });
      },
    },
  }
);

// 1) Séries d’étiquettes Bid/Ask/Médiane (axe de droite)
const bidLine = chart.addSeries(LightweightCharts.LineSeries, {
  color: 'rgba(0,150,0,1)', lineWidth: 1, lineVisible: false,
  lastValueVisible: true, title: 'Bid'
});
const askLine = chart.addSeries(LightweightCharts.LineSeries, {
  color: 'rgba(150,0,0,1)', lineWidth: 1, lineVisible: false,
  lastValueVisible: true, title: 'Ask'
});
const medianLine = chart.addSeries(LightweightCharts.LineSeries, {
  color: 'rgba(0,0,200,1)', lineWidth: 2, lineVisible: false,
  lastValueVisible: true
});

// 2) Conteneurs
let ticks = [];               // tous les ticks
let tfSeriesMap = {};         // timeframe → CandlestickSeries
let bucketsSmallest = {};     // bucket du plus petit TF → [ticks]


// Crée une CandlestickSeries par timeframe (axe gauche)
function prepareSeries(timeframes) {
  // supprimer les anciennes séries si besoin
  Object.values(tfSeriesMap).forEach(s => chart.removeSeries(s));
  tfSeriesMap = {};
  const palette = ['#26a69a','#ef5350','#29b6f6','#ffa726','#ab47bc','#8d6e63'];
  timeframes.forEach((tf,i) => {
    const color = palette[i % palette.length];
    tfSeriesMap[tf] = chart.addSeries(LightweightCharts.CandlestickSeries, {
      priceScaleId:     'left',
      upColor:          color,
      downColor:        color,
      wickUpColor:      color,
      wickDownColor:    color,
      borderVisible:    false,
      priceLineVisible: false,
      lastValueVisible: false,
    });
  });
}

// Regroupe tous les ticks sur le plus petit timeframe (en secondes)
function buildBuckets(smallTf) {
  bucketsSmallest = {};
  const bucketMs = smallTf * 1000;
  ticks.forEach(tk => {
    const key = Math.floor(tk.timeMs / bucketMs) * smallTf;
    (bucketsSmallest[key] ||= []).push(tk);
  });
}

// 5) Replay asynchrone multi-timeframe
async function startReplay(timeframes, speed) {
  document.getElementById('startBtn').disabled = true;
  const keys = Object.keys(bucketsSmallest).map(Number).sort((a,b) => a - b);
  // stocke les OHLC courants pour chaque timeframe
  const candlesMap = Object.fromEntries(timeframes.map(tf => [tf, {}]));

  for (const bucket of keys) {
    const slice = bucketsSmallest[bucket];
    // répartit uniformément les ticks sur duration = bucketSeconds/speed
    const dt = (timeframes[0]*1000) / (speed * slice.length);

    for (const { bid, ask, mid, timeMs } of slice) {
      // pour chaque timeframe, calcule son bucket et met à jour la bougie
      timeframes.forEach(tf => {
        const key = Math.floor(timeMs / (tf*1000)) * tf;
        const map = candlesMap[tf];
        if (!map[key]) {
          map[key] = { open: mid, high: mid, low: mid, close: mid };
        } else {
          const c = map[key];
          c.high  = Math.max(c.high, mid);
          c.low   = Math.min(c.low, mid);
          c.close = mid;
        }
        tfSeriesMap[tf].update({ time: key, ...map[key] });
      });

      // update Bid/Ask/Médiane (étiquettes)
      bidLine   .update({ time: bucket, value: bid });
      askLine   .update({ time: bucket, value: ask });
      medianLine.update({ time: bucket, value: mid });

      await new Promise(r => setTimeout(r, dt));
    }
  }

  document.getElementById('startBtn').disabled = false;
}

// 6) Légende dynamique avec OHLC + Bid/Ask/Médiane
chart.subscribeCrosshairMove(param => {
  const el = document.getElementById('dynamic-legend');
  if (!param || param.time === undefined) {
    el.textContent = ''; return;
  }
  const parts = [];
  // OHLC de chaque timeframe
  Object.entries(tfSeriesMap).forEach(([tf, series]) => {
    const v = param.seriesData.get(series);
    if (v && v.open !== undefined) {
      parts.push(
        `${tf}s → O:${v.open.toFixed(2)} H:${v.high.toFixed(2)} L:${v.low.toFixed(2)} C:${v.close.toFixed(2)}`
      );
    }
  });
  // valeurs Bid/Ask/Médiane
  [['Bid', bidLine], ['Ask', askLine], ['Méd', medianLine]].forEach(([name, s]) => {
    const v = param.seriesData.get(s);
    if (v) parts.push(`${name}:${v.value.toFixed(2)}`);
  });
  el.textContent = parts.join(' · ');
});

// 7) Adapter la taille du chart au resize
window.addEventListener('resize', () => {
  chart.applyOptions({ width: document.getElementById('container').clientWidth });
});
