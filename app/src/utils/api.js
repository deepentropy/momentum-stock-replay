const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/deepentropy/momentum-stock-replay/main/sessions';
const GITHUB_API_BASE = 'https://api.github.com/repos/deepentropy/momentum-stock-replay/contents/sessions';

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

    // Decompress using pako
    const pakoModule = await import('pako');
    const pako = pakoModule.default || pakoModule;
    
    let decompressed;
    try {
      const result = pako.inflate(new Uint8Array(arrayBuffer));
      
      if (!result) {
        throw new Error('Pako inflate returned null/undefined - file may be corrupted or not a valid gzip file');
      }
      
      // Ensure we have a proper Uint8Array with .buffer property
      decompressed = result instanceof Uint8Array ? result : new Uint8Array(result);
    } catch (error) {
      throw new Error(`Failed to decompress session data: ${error.message}`);
    }
    
    if (!decompressed || decompressed.length === 0) {
      throw new Error('Decompression resulted in invalid data');
    }

    // Detect version and parse accordingly
    const dataView = new DataView(decompressed.buffer);
    const version = dataView.getUint16(4, true); // Version is at offset 4, 2 bytes

    console.log(`📦 Detected binary format version: ${version}`);

    let parsedData;
    if (version === 3) {
      // Version 3: NBBO format with exchange snapshots
      parsedData = parseBinaryDataV3(decompressed);
      // V3 already has proper timestamps, no preprocessing needed
      return parsedData;
    } else {
      // Version 2: Legacy MBP-1 format
      parsedData = parseBinaryDataV2(decompressed);
      // Preprocess to add artificial milliseconds for V2
      const processedData = preprocessTimestamps(parsedData);
      return processedData;
    }
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

function parseBinaryDataV2(buffer) {
  // New binary format from compress.py (Databento MBP-1):
  // Header (18 bytes): Magic number (4 bytes) + Version (2 bytes) + Num rows (4 bytes) + Initial timestamp (8 bytes)
  // Data rows (64 bytes each): Full MBP-1 data with bid/ask prices, sizes, counts, and metadata

  const dataView = new DataView(buffer.buffer);
  let offset = 0;

  // Read header (18 bytes)
  const magicBytes = new Uint8Array(buffer.buffer, offset, 4);
  const magic = new TextDecoder().decode(magicBytes);
  offset += 4;

  const version = dataView.getUint16(offset, true); // 2 bytes now
  offset += 2;

  const numRows = dataView.getUint32(offset, true); // little-endian
  offset += 4;

  const initialTimestampUs = dataView.getBigUint64(offset, true); // little-endian, 8 bytes
  offset += 8;

  console.log(`📦 Binary format: Magic="${magic}", Version=${version}, Rows=${numRows}, InitialTimestamp=${initialTimestampUs}µs`);

  // Verify magic number
  if (magic !== 'TICK') {
    throw new Error(`Invalid binary format: expected magic "TICK", got "${magic}"`);
  }

  // Verify version
  if (version !== 2) {
    console.warn(`⚠️ Unexpected version ${version}, expected 2. Attempting to parse anyway...`);
  }

  // Parse data rows (64 bytes each)
  // Format: qBHIBBBqiHiIiiiiII
  // ts_event delta (8) + rtype (1) + publisher_id (2) + instrument_id (4) + action (1) + side (1) + depth (1) +
  // price (8) + size (4) + flags (2) + ts_in_delta (4) + sequence (4) +
  // bid_px_00 (4) + ask_px_00 (4) + bid_sz_00 (4) + ask_sz_00 (4) + bid_ct_00 (4) + ask_ct_00 (4)
  const data = [];
  const rowSize = 64; // bytes per row

  for (let i = 0; i < numRows; i++) {
    const rowOffset = offset + (i * rowSize);

    // Read row data (little-endian)
    const deltaTimeUs = dataView.getBigInt64(rowOffset, true);           // 8 bytes
    const rtype = dataView.getUint8(rowOffset + 8);                      // 1 byte
    const publisherId = dataView.getUint16(rowOffset + 9, true);         // 2 bytes
    const instrumentId = dataView.getUint32(rowOffset + 11, true);       // 4 bytes
    const action = dataView.getUint8(rowOffset + 15);                    // 1 byte (ASCII)
    const side = dataView.getUint8(rowOffset + 16);                      // 1 byte (ASCII)
    const depth = dataView.getUint8(rowOffset + 17);                     // 1 byte
    const priceScaled = dataView.getBigInt64(rowOffset + 18, true);      // 8 bytes
    const sizeScaled = dataView.getInt32(rowOffset + 26, true);          // 4 bytes
    const flags = dataView.getUint16(rowOffset + 30, true);              // 2 bytes
    const tsInDelta = dataView.getInt32(rowOffset + 32, true);           // 4 bytes
    const sequence = dataView.getUint32(rowOffset + 36, true);           // 4 bytes
    const priceBidScaled = dataView.getInt32(rowOffset + 40, true);      // 4 bytes
    const priceAskScaled = dataView.getInt32(rowOffset + 44, true);      // 4 bytes
    const sizeBidScaled = dataView.getInt32(rowOffset + 48, true);       // 4 bytes
    const sizeAskScaled = dataView.getInt32(rowOffset + 52, true);       // 4 bytes
    const bidCt00 = dataView.getUint32(rowOffset + 56, true);            // 4 bytes
    const askCt00 = dataView.getUint32(rowOffset + 60, true);            // 4 bytes

    // Calculate absolute timestamp in microseconds
    const absoluteTimestampUs = initialTimestampUs + deltaTimeUs;

    // Convert to milliseconds for JavaScript Date
    const timestampMs = Number(absoluteTimestampUs) / 1000;
    const timestamp = new Date(timestampMs).toISOString();

    // Convert back to original values
    const price = Number(priceScaled) / PRICE_SCALE;
    const size = sizeScaled / SIZE_SCALE;
    const priceBid = priceBidScaled / PRICE_SCALE;
    const priceAsk = priceAskScaled / PRICE_SCALE;
    const sizeBid = sizeBidScaled / SIZE_SCALE;
    const sizeAsk = sizeAskScaled / SIZE_SCALE;

    // Convert action and side from ASCII to char
    const actionChar = action > 0 ? String.fromCharCode(action) : ' ';
    const sideChar = side > 0 ? String.fromCharCode(side) : ' ';

    data.push({
      timestamp: timestamp,
      time: timestamp,
      // Primary bid/ask data (for display)
      priceBid: priceBid.toFixed(5),
      priceAsk: priceAsk.toFixed(5),
      sizeBid: sizeBid.toFixed(2),
      sizeAsk: sizeAsk.toFixed(2),
      bid_price: priceBid.toFixed(5),
      ask_price: priceAsk.toFixed(5),
      bid_size: sizeBid.toFixed(2),
      ask_size: sizeAsk.toFixed(2),
      // Additional Databento MBP-1 fields
      rtype: rtype,
      publisher_id: publisherId,
      instrument_id: instrumentId,
      action: actionChar,
      side: sideChar,
      depth: depth,
      price: price.toFixed(5),
      size: size.toFixed(2),
      flags: flags,
      ts_in_delta: tsInDelta,
      sequence: sequence,
      bid_ct_00: bidCt00,
      ask_ct_00: askCt00
    });
  }

  console.log(`✅ Parsed ${data.length} ticks from binary data (Databento MBP-1 format)`);
  if (data.length > 0) {
    console.log(`📊 First tick: ${data[0].timestamp} - Bid: ${data[0].priceBid}, Ask: ${data[0].priceAsk}`);
    console.log(`📊 Last tick: ${data[data.length - 1].timestamp} - Bid: ${data[data.length - 1].priceBid}, Ask: ${data[data.length - 1].priceAsk}`);
  }

  return data;
}

function parseBinaryDataV3(buffer) {
  // Version 3 binary format (NBBO with exchange snapshots):
  // Header:
  //   - TICK (4 bytes)
  //   - version 3 (2 bytes)
  //   - resample_interval_ms (2 bytes)
  //   - num_samples (4 bytes)
  //   - initial_timestamp (8 bytes, microseconds)
  //   - publisher_map_length (2 bytes)
  //   - publisher_map_string (variable)
  // Per Sample:
  //   - time_delta_ms (4 bytes)
  //   - NBBO (22 bytes)
  //   - num_exchanges (1 byte)
  //   - Exchange data (11 bytes each)

  const dataView = new DataView(buffer.buffer);
  let offset = 0;

  // Read header
  const magicBytes = new Uint8Array(buffer.buffer, offset, 4);
  const magic = new TextDecoder().decode(magicBytes);
  offset += 4;

  const version = dataView.getUint16(offset, true);
  offset += 2;

  const resampleIntervalMs = dataView.getUint16(offset, true);
  offset += 2;

  const numSamples = dataView.getUint32(offset, true);
  offset += 4;

  const initialTimestampUs = dataView.getBigUint64(offset, true);
  offset += 8;

  // Read publisher map
  const publisherMapLength = dataView.getUint16(offset, true);
  offset += 2;

  const publisherMapBytes = buffer.slice(offset, offset + publisherMapLength);
  const publisherMapStr = new TextDecoder().decode(publisherMapBytes);
  offset += publisherMapLength;

  // Parse publisher map: "0:1,1:2,2:3" -> {0: 1, 1: 2, 2: 3}
  const publisherMap = {};
  publisherMapStr.split(',').forEach(pair => {
    const [idx, pubId] = pair.split(':');
    publisherMap[parseInt(idx)] = parseInt(pubId);
  });

  console.log(`📦 Binary V3 format: samples=${numSamples}, interval=${resampleIntervalMs}ms, publishers=`, publisherMap);

  // Parse samples
  const data = [];
  let cumulativeTimestampMs = Number(initialTimestampUs) / 1000; // Convert to milliseconds

  for (let i = 0; i < numSamples; i++) {
    // Time delta
    const timeDeltaMs = dataView.getInt32(offset, true);
    offset += 4;
    cumulativeTimestampMs += timeDeltaMs;

    // NBBO data
    const nbboBid = dataView.getInt32(offset, true) / PRICE_SCALE;
    offset += 4;
    const nbboAsk = dataView.getInt32(offset, true) / PRICE_SCALE;
    offset += 4;
    const nbboBidSize = dataView.getInt32(offset, true) / SIZE_SCALE;
    offset += 4;
    const nbboAskSize = dataView.getInt32(offset, true) / SIZE_SCALE;
    offset += 4;
    const bestBidPub = dataView.getUint8(offset);
    offset += 1;
    const bestAskPub = dataView.getUint8(offset);
    offset += 1;

    // Exchange snapshots
    const numExchanges = dataView.getUint8(offset);
    offset += 1;

    const exchanges = [];
    for (let j = 0; j < numExchanges; j++) {
      const publisherIdx = dataView.getUint8(offset);
      offset += 1;
      const bid = dataView.getInt32(offset, true) / PRICE_SCALE;
      offset += 4;
      const ask = dataView.getInt32(offset, true) / PRICE_SCALE;
      offset += 4;
      const bidSize = dataView.getUint32(offset, true) / SIZE_SCALE;
      offset += 4;
      const askSize = dataView.getUint32(offset, true) / SIZE_SCALE;
      offset += 4;

      exchanges.push({
        publisher_id: publisherMap[publisherIdx],
        publisher_index: publisherIdx,
        bid_price: bid.toFixed(5),
        ask_price: ask.toFixed(5),
        bid_size: bidSize.toFixed(2),
        ask_size: askSize.toFixed(2)
      });
    }

    // Create timestamp (Unix timestamp in seconds with milliseconds)
    const timestamp = new Date(cumulativeTimestampMs).toISOString();
    const adjustedTimestamp = cumulativeTimestampMs / 1000; // Unix timestamp in seconds

    data.push({
      timestamp: timestamp,
      time: timestamp,
      adjustedTimestamp: adjustedTimestamp,
      // NBBO for charts
      bid_price: nbboBid.toFixed(5),
      ask_price: nbboAsk.toFixed(5),
      bid_size: nbboBidSize.toFixed(2),
      ask_size: nbboAskSize.toFixed(2),
      priceBid: nbboBid.toFixed(5),
      priceAsk: nbboAsk.toFixed(5),
      sizeBid: nbboBidSize.toFixed(2),
      sizeAsk: nbboAskSize.toFixed(2),
      // NBBO metadata
      nbbo: true,
      best_bid_publisher: publisherMap[bestBidPub],
      best_ask_publisher: publisherMap[bestAskPub],
      // Exchange snapshots for order book
      exchanges: exchanges
    });
  }

  console.log(`✅ Parsed ${data.length} NBBO samples from binary data (Version 3)`);
  if (data.length > 0) {
    console.log(`📊 First sample: ${data[0].timestamp} - NBBO Bid: ${data[0].priceBid}, Ask: ${data[0].priceAsk}`);
    console.log(`📊 Last sample: ${data[data.length - 1].timestamp} - NBBO Bid: ${data[data.length - 1].priceBid}, Ask: ${data[data.length - 1].priceAsk}`);
    console.log(`📊 Exchanges per sample: ${data[0].exchanges.length}`);
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
