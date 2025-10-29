const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/houseofai/momentum-stock-replay/main';
const GITHUB_API_BASE = 'https://api.github.com/repos/houseofai/momentum-stock-replay/contents';

// Constants matching your Python script (compress.py)
const PRICE_SCALE = 100_000; // 5 decimal places precision
const SIZE_SCALE = 100; // 2 decimal places precision
const TIME_UNIT = 1_000_000; // µs for tick data

export const api = {
  async getSessions() {
    const response = await fetch(GITHUB_API_BASE);
    if (!response.ok) {
      throw new Error('Failed to fetch sessions from GitHub');
    }
    const files = await response.json();

    // Filter only .bin.gz files (excluding -l2.bin.gz)
    const binaryFiles = files.filter(file =>
      file.name.endsWith('.bin.gz') &&
      !file.name.endsWith('-l2.bin.gz') &&
      file.type === 'file'
    );

    // Transform to session format with enhanced metadata
    return binaryFiles.map(file => {
      // Parse filename: SYMBOL-YYYYMMDD.bin.gz
      const nameWithoutExt = file.name.replace('.bin.gz', '');
      const parts = nameWithoutExt.split('-');
      const symbol = parts[0];
      const dateStr = parts[1]; // YYYYMMDD format

      // Format date as YYYY-MM-DD
      let formattedDate = dateStr;
      if (dateStr && dateStr.length === 8) {
        formattedDate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
      }

      return {
        id: nameWithoutExt,
        name: nameWithoutExt,
        symbol: symbol,
        date: formattedDate,
        size: file.size,
        download_url: file.download_url,
        // These will be populated when data is loaded
        px_start: null,
        px_end: null,
        duration_m: null,
        tickCount: null
      };
    });
  },

  async loadSessionData(sessionId) {
    const url = `${GITHUB_RAW_BASE}/${sessionId}.bin.gz`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load session data: ${response.statusText}`);
    }

    // Get the compressed binary data
    const arrayBuffer = await response.arrayBuffer();

    // Decompress using pako (you'll need to install: npm install pako)
    const pako = await import('pako');
    const decompressed = pako.inflate(new Uint8Array(arrayBuffer));

    // Parse binary data
    const parsedData = parseBinaryData(decompressed);

    // Try to load Level 2 data with -l2.bin.gz suffix
    let level2Data = null;
    try {
      const l2Url = `${GITHUB_RAW_BASE}/${sessionId}-l2.bin.gz`;
      const l2Response = await fetch(l2Url);
      if (l2Response.ok) {
        const l2ArrayBuffer = await l2Response.arrayBuffer();
        const l2Decompressed = pako.inflate(new Uint8Array(l2ArrayBuffer));
        level2Data = parseBinaryLevel2Data(l2Decompressed);
        console.log(`✅ Loaded ${level2Data.length} Level 2 entries for ${sessionId}`);
      }
    } catch (error) {
      console.log(`ℹ️ No Level 2 data available for ${sessionId}: ${error.message}`);
    }

    // Preprocess to add artificial milliseconds
    const processedData = preprocessTimestamps(parsedData);

    // Attach level2 data to the result if available
    if (level2Data) {
      processedData.level2Data = level2Data;
    }

    return processedData;
  },

  // New method to get session metadata without loading all data
  async getSessionMetadata(sessionId) {
    try {
      const data = await this.loadSessionData(sessionId);
      if (data.length === 0) {
        return null;
      }

      const firstTick = data[0];
      const lastTick = data[data.length - 1];

      const startTime = new Date(firstTick.timestamp || firstTick.time);
      const endTime = new Date(lastTick.timestamp || lastTick.time);
      const durationMs = endTime - startTime;
      const durationMinutes = Math.round(durationMs / 60000);

      return {
        px_start: parseFloat(firstTick.priceBid || firstTick.bid_price),
        px_end: parseFloat(lastTick.priceBid || lastTick.bid_price),
        duration_m: durationMinutes,
        tickCount: data.length,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString()
      };
    } catch (error) {
      console.error(`Failed to load metadata for ${sessionId}:`, error);
      return null;
    }
  }
};

function parseBinaryData(buffer) {
  // New binary format from compress.py:
  // Header (17 bytes): Magic number (4 bytes) + Version (1 byte) + Num rows (4 bytes) + Initial timestamp (8 bytes)
  // Data rows (24 bytes each): int64 delta_time_us + int32 price_bid + int32 price_ask + int32 size_bid + int32 size_ask

  const dataView = new DataView(buffer.buffer);
  let offset = 0;

  // Read header (17 bytes)
  const magicBytes = new Uint8Array(buffer.buffer, offset, 4);
  const magic = new TextDecoder().decode(magicBytes);
  offset += 4;

  const version = dataView.getUint8(offset);
  offset += 1;

  const numRows = dataView.getUint32(offset, true); // little-endian
  offset += 4;

  const initialTimestampUs = dataView.getBigUint64(offset, true); // little-endian, 8 bytes
  offset += 8;

  console.log(`📦 Binary format: Magic="${magic}", Version=${version}, Rows=${numRows}, InitialTimestamp=${initialTimestampUs}µs`);

  // Verify magic number
  if (magic !== 'TICK') {
    throw new Error(`Invalid binary format: expected magic "TICK", got "${magic}"`);
  }

  // Parse data rows (24 bytes each)
  const data = [];
  const rowSize = 24; // bytes per row

  for (let i = 0; i < numRows; i++) {
    const rowOffset = offset + (i * rowSize);

    // Read row data (little-endian)
    // int64 delta_time_us (8 bytes) + int32 price_bid (4) + int32 price_ask (4) + int32 size_bid (4) + int32 size_ask (4)
    const deltaTimeUs = dataView.getBigInt64(rowOffset, true);
    const priceBidScaled = dataView.getInt32(rowOffset + 8, true);
    const priceAskScaled = dataView.getInt32(rowOffset + 12, true);
    const sizeBidScaled = dataView.getInt32(rowOffset + 16, true);
    const sizeAskScaled = dataView.getInt32(rowOffset + 20, true);

    // Calculate absolute timestamp in microseconds
    const absoluteTimestampUs = initialTimestampUs + deltaTimeUs;

    // Convert to milliseconds for JavaScript Date
    const timestampMs = Number(absoluteTimestampUs) / 1000;
    const timestamp = new Date(timestampMs).toISOString();

    // Convert back to original values
    const priceBid = priceBidScaled / PRICE_SCALE;
    const priceAsk = priceAskScaled / PRICE_SCALE;
    const sizeBid = sizeBidScaled / SIZE_SCALE;
    const sizeAsk = sizeAskScaled / SIZE_SCALE;

    data.push({
      timestamp: timestamp,
      time: timestamp,
      priceBid: priceBid.toFixed(5),
      priceAsk: priceAsk.toFixed(5),
      sizeBid: sizeBid.toFixed(2),
      sizeAsk: sizeAsk.toFixed(2),
      bid_price: priceBid.toFixed(5),
      ask_price: priceAsk.toFixed(5),
      bid_size: sizeBid.toFixed(2),
      ask_size: sizeAsk.toFixed(2)
    });
  }

  console.log(`✅ Parsed ${data.length} ticks from binary data`);
  if (data.length > 0) {
    console.log(`📊 First tick: ${data[0].timestamp} - Bid: ${data[0].priceBid}, Ask: ${data[0].priceAsk}`);
    console.log(`📊 Last tick: ${data[data.length - 1].timestamp} - Bid: ${data[data.length - 1].priceBid}, Ask: ${data[data.length - 1].priceAsk}`);
  }

  return data;
}

function parseBinaryLevel2Data(buffer) {
  // Structure from Python:
  // Header: uint64 (8 bytes) = initial_timestamp_ms
  //         uint32 (4 bytes) = length of mapping string
  //         mapping string (exchange mapping: "0:EXCHANGE1,1:EXCHANGE2,...")
  // Data rows: int32 delta_time_ms, int32 price_delta, int32 size, uint8 entry_type, uint8 exchange_code
  //            (4 + 4 + 4 + 1 + 1 = 14 bytes per row)

  const dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 0;

  // Read header: initial timestamp
  const initialTimestampMs = Number(dataView.getBigUint64(offset, true)); // little-endian, 8 bytes
  offset += 8;

  // Read mapping length
  const mappingLength = dataView.getUint32(offset, true); // little-endian
  offset += 4;

  // Read mapping string
  const mappingBytes = buffer.slice(offset, offset + mappingLength);
  const mappingStr = new TextDecoder().decode(mappingBytes);
  offset += mappingLength;

  // Parse exchange mapping: "0:NASDAQ,1:NYSE,..."
  const exchangeMap = {};
  mappingStr.split(',').forEach(pair => {
    const [code, exchange] = pair.split(':');
    exchangeMap[parseInt(code)] = exchange;
  });

  console.log(`📊 Exchange mapping:`, exchangeMap);
  console.log(`📊 Initial timestamp:`, initialTimestampMs, 'ms');

  // Parse data rows
  const rowSize = 14; // bytes per row
  const numRows = (buffer.length - offset) / rowSize;
  const data = [];

  let cumulativeTimeMs = initialTimestampMs; // Start from initial timestamp
  let cumulativePrice = 0;

  for (let i = 0; i < numRows; i++) {
    const rowOffset = offset + (i * rowSize);

    // Read row data (little-endian)
    const deltaTimeMs = dataView.getInt32(rowOffset, true);
    const priceDelta = dataView.getInt32(rowOffset + 4, true);
    const size = dataView.getInt32(rowOffset + 8, true);
    const entryType = dataView.getUint8(rowOffset + 12);
    const exchangeCode = dataView.getUint8(rowOffset + 13);

    // Accumulate time and price
    cumulativeTimeMs += deltaTimeMs;
    cumulativePrice += priceDelta;

    // Convert back to original values
    const price = cumulativePrice / PRICE_SCALE;
    const exchange = exchangeMap[exchangeCode] || 'UNKNOWN';

    // Create timestamp from cumulative milliseconds
    const timestamp = new Date(cumulativeTimeMs).toISOString();

    data.push({
      timestamp: timestamp,
      timestamp_ms: cumulativeTimeMs,
      price: parseFloat(price.toFixed(4)),
      size: size,
      exchange: exchange,
      entry_type: entryType // 0 = bid, 1 = ask
    });
  }

  console.log(`✅ Parsed ${data.length} Level 2 entries from binary data`);
  if (data.length > 0) {
    console.log(`📊 First entry:`, data[0]);
    console.log(`📊 Last entry:`, data[data.length - 1]);
  }

  return data;
}

function preprocessTimestamps(data) {
  if (data.length === 0) return data;

  console.log('🔧 Preprocessing timestamps to add artificial milliseconds...');

  // Group ticks by second
  const ticksBySecond = new Map();

  data.forEach((tick, index) => {
    const timestamp = tick.timestamp || tick.time;
    const date = new Date(timestamp);

    // Round to nearest second (remove milliseconds if any)
    const secondTimestamp = Math.floor(date.getTime() / 1000);

    if (!ticksBySecond.has(secondTimestamp)) {
      ticksBySecond.set(secondTimestamp, []);
    }

    ticksBySecond.get(secondTimestamp).push({ tick, originalIndex: index });
  });

  // Create new array with adjusted timestamps
  const processedData = [];

  ticksBySecond.forEach((ticks, secondTimestamp) => {
    const tickCount = ticks.length;

    if (tickCount === 1) {
      // Only one tick in this second, keep original timestamp
      const { tick } = ticks[0];
      processedData.push({
        ...tick,
        adjustedTimestamp: secondTimestamp, // Unix timestamp in seconds
      });
    } else {
      // Multiple ticks in same second - distribute evenly
      const msIncrement = 1000 / tickCount; // Milliseconds to add between ticks

      ticks.forEach(({ tick }, index) => {
        const msOffset = Math.floor(index * msIncrement);
        const adjustedTimestamp = secondTimestamp + (msOffset / 1000); // Add fractional seconds

        processedData.push({
          ...tick,
          adjustedTimestamp: adjustedTimestamp, // Unix timestamp with fractional seconds
        });
      });
    }
  });

  // Sort by adjusted timestamp to maintain chronological order
  processedData.sort((a, b) => a.adjustedTimestamp - b.adjustedTimestamp);

  const duplicates = data.length - new Set(processedData.map(d => d.adjustedTimestamp)).size;
  console.log(`✅ Preprocessed ${data.length} ticks, distributed across ${ticksBySecond.size} seconds`);
  if (duplicates > 0) {
    console.warn(`⚠️ Still have ${duplicates} duplicate timestamps after preprocessing`);
  }

  return processedData;
}