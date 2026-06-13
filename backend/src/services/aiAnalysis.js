const Anthropic = require('@anthropic-ai/sdk');
const { db } = require('../config/database');
const { cacheGet, cacheSet } = require('../config/redis');
const logger = require('../config/logger');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = parseInt(process.env.ANTHROPIC_MAX_TOKENS) || 1024;

let anthropic = null;
function getClient() {
  if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic;
}

const SYSTEM_PROMPT = `You are an expert financial analyst and algorithmic trader with deep knowledge of technical analysis, market microstructure, and risk management.

Analyze the provided market data, technical indicators, and recent news headlines to generate a precise trading signal.

Respond ONLY with valid JSON (no markdown, no backticks) matching this exact structure:
{
  "signal": "buy" | "sell" | "hold",
  "confidence": <integer 0-100>,
  "reasoning": "<concise 2-3 sentence explanation>",
  "entry_price": <number | null>,
  "stop_loss": <number | null>,
  "take_profit": <number | null>,
  "predicted_high": <number | null>,
  "predicted_low": <number | null>,
  "risk_reward": <number | null>,
  "key_levels": {"support": <number | null>, "resistance": <number | null>},
  "timeframe_bias": "<short/medium/long>",
  "catalysts": ["<risk factor 1>", "<risk factor 2>"]
}

Rules:
- confidence < 50 → always "hold"
- Stop-loss must be set for buy/sell signals
- Base all analysis strictly on the provided data`;

function buildPrompt(symbol, timeframe, priceData, indicators, news = []) {
  const { current_price, previous_close, candles } = priceData;
  const recent = candles.slice(-5).map(c =>
    `  ${c.time.slice(0,16)} O:${c.open?.toFixed(2)} H:${c.high?.toFixed(2)} L:${c.low?.toFixed(2)} C:${c.close?.toFixed(2)} V:${c.volume?.toLocaleString()}`
  ).join('\n');

  const newsSection = news.length
    ? `\n\n## Recent News Headlines\n${news.map(n => `- "${n.headline}" (${n.source}, ${n.created_at?.slice(0, 10)})`).join('\n')}`
    : '\n\n## Recent News Headlines\nNone available.';

  return `Analyze ${symbol} on the ${timeframe} timeframe and generate a trading signal.

## Market Snapshot
- Symbol: ${symbol}
- Current Price: ${current_price}
- Previous Close: ${previous_close}
- Change: ${((current_price - previous_close) / previous_close * 100).toFixed(2)}%

## Recent ${timeframe} Candles (last 5)
${recent}

## Technical Indicators
- RSI(14): ${indicators.rsi_14 ?? 'N/A'}
- MACD: ${indicators.macd ? `${indicators.macd.macd?.toFixed(4)} | Signal: ${indicators.macd.signal?.toFixed(4)} | Hist: ${indicators.macd.histogram?.toFixed(4)}` : 'N/A'}
- SMA(20): ${indicators.sma_20 ?? 'N/A'}  SMA(50): ${indicators.sma_50 ?? 'N/A'}  SMA(200): ${indicators.sma_200 ?? 'N/A'}
- EMA(12): ${indicators.ema_12 ?? 'N/A'}  EMA(26): ${indicators.ema_26 ?? 'N/A'}
- Bollinger Bands: Upper ${indicators.bollinger_bands?.upper?.toFixed(2) ?? 'N/A'} | Mid ${indicators.bollinger_bands?.middle?.toFixed(2) ?? 'N/A'} | Lower ${indicators.bollinger_bands?.lower?.toFixed(2) ?? 'N/A'}
- VWAP: ${indicators.vwap ?? 'N/A'}
- Stochastic %K: ${indicators.stochastic?.k?.toFixed(1) ?? 'N/A'}  %D: ${indicators.stochastic?.d?.toFixed(1) ?? 'N/A'}
- ATR(14): ${indicators.atr_14 ?? 'N/A'}${newsSection}`;
}

async function generateSignal(userId, symbol, timeframe, priceData, indicators, news = []) {
  // Check cache first — don't re-analyze same symbol+timeframe within 5 minutes
  const cacheKey = `signal:${symbol}:${timeframe}`;
  const cached = await cacheGet(cacheKey);
  if (cached && cached.user_id !== userId) {
    // Return shared cached analysis (different user requested same symbol)
    logger.info({ symbol, timeframe }, 'Returning cached signal');
    return { ...cached, cached: true };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw Object.assign(new Error('AI analysis not configured (ANTHROPIC_API_KEY missing)'), { status: 503 });
  }

  const prompt = buildPrompt(symbol, timeframe, priceData, indicators, news);

  let message;
  try {
    message = await getClient().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    logger.error({ err: err.message, symbol }, 'Anthropic API error');
    throw Object.assign(new Error(`AI service error: ${err.message}`), { status: 502 });
  }

  const tokensUsed = message.usage?.input_tokens + message.usage?.output_tokens || 0;
  const rawText = message.content?.[0]?.text || '';

  let parsed;
  try {
    parsed = JSON.parse(rawText.trim());
  } catch {
    throw Object.assign(new Error('AI returned malformed JSON — please retry'), { status: 502 });
  }

  // Validate required fields
  if (!['buy', 'sell', 'hold'].includes(parsed.signal)) {
    throw Object.assign(new Error('AI returned invalid signal type'), { status: 502 });
  }

  // Fold news headlines into the persisted indicators blob so they ride along
  // with the cached/stored signal without requiring a schema change.
  const indicatorsWithNews = news.length ? { ...indicators, news } : indicators;

  const signalData = {
    user_id: userId,
    symbol,
    timeframe,
    signal: parsed.signal,
    confidence: Math.min(100, Math.max(0, parsed.confidence || 0)),
    reasoning: parsed.reasoning || '',
    entry_price: priceData.current_price,
    stop_loss: parsed.stop_loss,
    take_profit: parsed.take_profit,
    predicted_high: parsed.predicted_high,
    predicted_low: parsed.predicted_low,
    risk_reward: parsed.risk_reward,
    key_levels: parsed.key_levels || {},
    timeframe_bias: parsed.timeframe_bias,
    catalysts: parsed.catalysts || [],
    indicators: indicatorsWithNews,
    ai_model: MODEL,
    ai_tokens_used: tokensUsed,
    cached: false,
  };

  // Persist to DB
  try {
    const row = await db.one(
      `INSERT INTO historical_signals
         (user_id, symbol, timeframe, signal_type, confidence, analysis_text,
          ai_model, ai_tokens_used, entry_price, stop_loss, take_profit,
          predicted_price_high, predicted_price_low, indicators,
          expires_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
               CURRENT_TIMESTAMP + INTERVAL '4 hours', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING id, created_at`,
      [
        userId, symbol, timeframe, parsed.signal, signalData.confidence, parsed.reasoning,
        MODEL, tokensUsed, priceData.current_price, parsed.stop_loss, parsed.take_profit,
        parsed.predicted_high, parsed.predicted_low, JSON.stringify(indicatorsWithNews),
      ]
    );
    signalData.id = row.id;
    signalData.created_at = row.created_at;

    // Update signal_cache table for fast dashboard reads
    await db.none(
      `INSERT INTO signal_cache (symbol, market, latest_signal_id, signal_data, updated_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (symbol) DO UPDATE
         SET latest_signal_id = EXCLUDED.latest_signal_id,
             signal_data = EXCLUDED.signal_data,
             updated_at = CURRENT_TIMESTAMP`,
      [symbol, 'AUTO', row.id, JSON.stringify(signalData)]
    );

    // Track usage metric
    await db.none(
      `INSERT INTO usage_metrics (user_id, metric_name, usage_count, billing_period_start, billing_period_end)
       VALUES ($1, 'ai_analyses', 1, date_trunc('month', CURRENT_TIMESTAMP), date_trunc('month', CURRENT_TIMESTAMP) + INTERVAL '1 month')
       ON CONFLICT DO NOTHING`,
      [userId]
    ).catch(() => {
      // Non-fatal — increment instead
      db.none(
        `UPDATE usage_metrics SET usage_count = usage_count + 1, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND metric_name = 'ai_analyses'
           AND billing_period_start = date_trunc('month', CURRENT_TIMESTAMP)`,
        [userId]
      ).catch(() => {});
    });
  } catch (dbErr) {
    logger.warn({ err: dbErr.message }, 'Failed to persist signal to DB');
  }

  // Cache for 5 minutes
  await cacheSet(cacheKey, signalData, 300);
  logger.info({ symbol, timeframe, signal: parsed.signal, confidence: signalData.confidence, tokens: tokensUsed }, 'Signal generated');

  return signalData;
}

module.exports = { generateSignal };
