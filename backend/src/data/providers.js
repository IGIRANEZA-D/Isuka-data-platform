const { initializeDatabase } = require('./database');

async function fetchAIProvider(url, options, provider, timeoutMs = 30000) {
  const retryableStatuses = new Set([500, 502, 503, 504]);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response;
    try {
      response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        continue;
      }
      const causeCode = error?.cause?.code || (error?.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR');
      const failure = new Error(`${provider} request failed (${causeCode}).`);
      failure.code = 'AI_PROVIDER_NETWORK_ERROR';
      failure.provider = provider;
      throw failure;
    }

    if (attempt === 0 && retryableStatuses.has(response.status)) {
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, 300));
      continue;
    }
    return response;
  }
  throw new Error(`${provider} request failed (NETWORK_ERROR).`);
}

function createAIProviderResponseError(provider, status) {
  const failure = new Error(`${provider} returned HTTP ${status}.`);
  failure.code = 'AI_PROVIDER_HTTP_ERROR';
  failure.provider = provider;
  failure.status = status;
  return failure;
}

async function getWeather(latitude, longitude) {
  if (process.env.METEOMATICS_USER && process.env.METEOMATICS_PASSWORD) {
    const start = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const end = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const parameters = [
      't_2m:C', 'relative_humidity_2m:p', 'precip_1h:mm', 'precip_24h:mm',
      'wind_speed_10m:ms', 'wind_gusts_10m_1h:kmh', 'tstorm_warning_1h:idx',
      'heavy_rain_warning_24h:idx', 'wind_warning_1h:idx'
    ].join(',');
    const url = `${process.env.METEOMATICS_API_URL || 'https://api.meteomatics.com'}/${start}--${end}:PT1H/${parameters}/${latitude},${longitude}/json?model=mix`;
    const credentials = Buffer.from(`${process.env.METEOMATICS_USER}:${process.env.METEOMATICS_PASSWORD}`).toString('base64');
    const response = await fetch(url, { headers: { Authorization: `Basic ${credentials}` }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Meteomatics returned ${response.status}.`);
    return { provider: 'meteomatics', ...await response.json() };
  }
  const params = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), current: 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m', timezone: 'Africa/Kigali' });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Weather provider returned ${response.status}.`);
  return { provider: 'open-meteo', ...await response.json() };
}

function cropKnowledge(message, farm) {
  const text = `${message} ${farm.map((record) => `${record.cropName || ''} ${record.species || ''}`).join(' ')}`.toLowerCase();
  const guidance = [];
  if (/(maize|corn|stalk|cob|fall armyworm|armyworm)/.test(text)) guidance.push('For maize: scout the whorl and underside of leaves for chewing, frass, or ragged holes; remove heavily infested plants where practical and use only a locally registered product at its label rate after confirming the pest.');
  if (/(bean|beans|leaf spot|rust|aphid)/.test(text)) guidance.push('For beans: inspect both leaf surfaces and pods for spots, rust-like powder, lesions, or aphids; remove badly affected plants, improve spacing and field sanitation, and avoid wetting foliage.');
  if (/(tomato|potato|blight)/.test(text)) guidance.push('For tomato or potato: check whether lesions expand after rain and inspect stems and fruit; remove affected material, avoid overhead irrigation, and seek local extension advice before applying a fungicide.');
  if (/(cattle|goat|pig|poultry|chicken|livestock|animal)/.test(text)) guidance.push('For livestock: isolate visibly sick animals where safe, provide clean water and shade or shelter, record temperature or other observable signs if trained, and contact a veterinary officer for breathing difficulty, severe diarrhea, bleeding, poisoning, or sudden deaths.');
  return guidance;
}

function assistantContext(context, message) {
  const profile = context.profile || {};
  const farm = Array.isArray(context.farm) ? context.farm : [];
  const weather = context.weather || null;
  return {
    farmer: {
      name: [profile.firstName, profile.lastName].filter(Boolean).join(' ') || null,
      district: profile.district || weather?.location?.district || null,
      country: profile.country || 'Rwanda',
      farmingFocus: profile.setup?.management || null,
      cropsSelectedDuringSetup: profile.setup?.crops || [],
      livestockSelectedDuringSetup: profile.setup?.animals || []
    },
    farmRecords: farm.map((record) => ({
      recordType: record.recordType,
      cropName: record.cropName,
      variety: record.variety,
      plotName: record.plotName,
      area: record.area,
      plantingDate: record.plantingDate,
      expectedHarvestDate: record.expectedHarvestDate,
      stage: record.stage,
      expectedYield: record.expectedYield,
      harvestQuantity: record.harvestQuantity,
      harvestQuality: record.harvestQuality,
      species: record.species,
      name: record.name,
      count: record.count,
      sex: record.sex,
      status: record.status,
      expectedBirthDate: record.expectedBirthDate,
      nextVaccinationDate: record.nextVaccinationDate,
      notes: record.notes
    })),
    weather: weather ? {
      provider: weather.provider,
      location: weather.location,
      current: weather.current,
      nextSevenDays: weather.forecast?.daily || [],
      agriculture: weather.agriculture,
      livestock: weather.livestock,
      alerts: weather.alerts
    } : { unavailable: true },
    farmAlerts: context.farmAlerts || [],
    localAgricultureEvidence: context.publicDashboard || null,
    relevantFieldGuidance: cropKnowledge(message, farm)
  };
}

function assistantInstructions(district) {
  const location = district || 'the farmer\'s district';
  return `You are Isuka, a practical Rwanda agriculture assistant for a farmer in ${location}.
Use the FARMER CONTEXT as the source of truth for the farmer's identity, district, crops, livestock, dates, health status, weather, alerts, and available local production evidence.
Answer the farmer's actual question first. Do not ask for information that is already in FARMER CONTEXT. Do not respond with a long intake questionnaire.
When a disease or pest is mentioned but the symptoms are incomplete, give safe immediate steps first, explain the most likely possibilities without claiming a diagnosis, then ask no more than two targeted follow-up questions. Ask for a clear plant or animal photo when useful.
Use the current and seven-day weather forecast in the advice when relevant, and clearly say when weather data is unavailable or stale. Adapt advice to Eastern Rwanda and Ngoma conditions.
For pesticides, veterinary medicines, or animal treatments, never invent a product, dose, withdrawal period, or diagnosis. Recommend a Rwanda-registered product only according to its label and advise contacting a Rwanda extension or veterinary officer for confirmation, especially for severe symptoms.
Prefer practical steps, timing, monitoring signs, and escalation warnings. Mention the specific farm record you used when one matches the question. Keep the answer concise and understandable in English, and include a short Kinyarwanda greeting only when it feels natural.`;
}

async function askAssistant(message, context = {}, attachment = null) {
  const farmContext = assistantContext(context, message);
  const prompt = `${assistantInstructions(farmContext.farmer.district)}

FARMER CONTEXT (private account data; use only to answer this farmer):
${JSON.stringify(farmContext)}

FARMER QUESTION:
${message}`;
  const attachmentPart = attachment?.buffer ? attachment.mimetype === 'text/plain'
    ? { text: `UPLOADED FILE (${attachment.originalname}):\n${attachment.buffer.toString('utf8').slice(0, 20000)}` }
    : { inline_data: { mime_type: attachment.mimetype, data: attachment.buffer.toString('base64') } }
    : null;
  if (attachment?.mimetype === 'application/pdf' && !process.env.GEMINI_API_KEY) throw new Error('PDF analysis requires the configured Gemini provider. Upload an image or text file instead.');
  if (process.env.GEMINI_API_KEY) {
    const response = await fetchAIProvider(`https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || 'gemini-2.0-flash'}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, ...(attachmentPart ? [attachmentPart] : [])] }] })
    }, 'Gemini');
    if (!response.ok) throw createAIProviderResponseError('Gemini', response.status);
    const result = await response.json();
    return result.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || 'The assistant returned no answer.';
  }
  if (!process.env.OPENAI_API_KEY) throw new Error('AI assistant is not configured. Set GEMINI_API_KEY or OPENAI_API_KEY before enabling this service.');
  const openAiContent = [{ type: 'input_text', text: `FARMER CONTEXT:\n${JSON.stringify(farmContext)}\n\nFARMER QUESTION:\n${message}` }];
  if (attachmentPart?.inline_data) openAiContent.push({ type: 'input_image', image_url: `data:${attachment.mimetype};base64,${attachment.buffer.toString('base64')}` });
  if (attachmentPart?.text) openAiContent[0].text += `\n\n${attachmentPart.text}`;
  const response = await fetch(process.env.OPENAI_API_URL || 'https://api.openai.com/v1/responses', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', input: [{ role: 'system', content: assistantInstructions(farmContext.farmer.district) }, { role: 'user', content: openAiContent }] }), signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(response.status === 429 || response.status === 503 ? 'The AI service is temporarily busy. Please try again in a moment.' : 'The AI service could not process that request.');
  const result = await response.json();
  return result.output_text || result.output?.flatMap((item) => item.content || []).map((item) => item.text).filter(Boolean).join('\n') || 'The assistant returned no answer.';
}

function deterministicDatasetReview(validationResult) {
  const recommendation = validationResult.aiRecommendation || (validationResult.status === 'pass' ? 'approve' : validationResult.status === 'fail' ? 'reject' : 'needs_review');
  const reasons = validationResult.warnings || [];
  const requiredChanges = Object.entries(validationResult.issues || {}).map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  const systemChecks = Object.entries(validationResult.periodCheck || {}).map(([key, value]) => `${key}: ${String(value)}`);
  const modelChecks = (validationResult.modelReadiness?.algorithms || []).map((algorithm) => `${algorithm.ready ? 'passed' : 'blocked'}: ${algorithm.name}`);
  return {
    recommendation,
    summary: validationResult.aiSummary,
    confidence: validationResult.status === 'pass' ? 0.92 : validationResult.status === 'fail' ? 0.94 : 0.78,
    readinessPercentage: validationResult.readinessScore ?? 0,
    confidencePercentage: validationResult.status === 'pass' ? 92 : validationResult.status === 'fail' ? 94 : 78,
    details: {
      basis: 'deterministic_validation',
      warnings: validationResult.warnings,
      issues: validationResult.issues,
      reasons,
      whyBlocked: recommendation === 'reject' ? reasons : [],
      requiredChanges,
      missingInformation: validationResult.issues?.missingColumns || [],
      systemChecks,
      modelChecks,
      publicationRisk: recommendation === 'reject' ? 'high' : recommendation === 'needs_review' ? 'medium' : 'low',
      nextStep: recommendation === 'approve' ? 'Proceed to admin publication review.' : recommendation === 'reject' ? 'Repair the file and upload a new version.' : 'Ask an admin to review the warnings before publication.'
    },
    provider: 'deterministic'
  };
}

function parseDatasetReview(rawText, validationResult) {
  const text = String(rawText || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  let parsed;
  try { parsed = JSON.parse(text); } catch { return deterministicDatasetReview(validationResult); }
  const recommendation = ['approve', 'needs_review', 'reject'].includes(parsed.recommendation) ? parsed.recommendation : validationResult.aiRecommendation;
  const confidence = Number(parsed.confidence);
  const details = parsed.details && typeof parsed.details === 'object' ? parsed.details : {};
  return {
    recommendation,
    summary: String(parsed.summary || validationResult.aiSummary).slice(0, 2000),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.7,
    readinessPercentage: Number.isFinite(Number(parsed.readinessPercentage)) ? Math.max(0, Math.min(100, Math.round(Number(parsed.readinessPercentage)))) : validationResult.readinessScore ?? 0,
    confidencePercentage: Number.isFinite(Number(parsed.confidencePercentage)) ? Math.max(0, Math.min(100, Math.round(Number(parsed.confidencePercentage)))) : Math.round((Number.isFinite(confidence) ? confidence : 0.7) * 100),
    details: {
      ...details,
      reasons: Array.isArray(details.reasons) ? details.reasons.slice(0, 20) : [],
      whyBlocked: Array.isArray(details.whyBlocked) ? details.whyBlocked.slice(0, 20) : [],
      requiredChanges: Array.isArray(details.requiredChanges) ? details.requiredChanges.slice(0, 20) : [],
      missingInformation: Array.isArray(details.missingInformation) ? details.missingInformation.slice(0, 20) : [],
      systemChecks: Array.isArray(details.systemChecks) ? details.systemChecks.slice(0, 20) : [],
      modelChecks: Array.isArray(details.modelChecks) ? details.modelChecks.slice(0, 20) : [],
      publicationRisk: ['low', 'medium', 'high'].includes(details.publicationRisk) ? details.publicationRisk : 'medium'
    },
    provider: parsed.provider || 'configured_ai'
  };
}

async function reviewDatasetWithAI(dataset, validationResult) {
  const deterministic = deterministicDatasetReview(validationResult);
  const facts = {
    title: dataset.title,
    fileName: dataset.fileName,
    datasetType: dataset.datasetType,
    rowCount: validationResult.rowCount,
    validRows: validationResult.validRows,
    invalidRows: validationResult.invalidRows,
    readabilityScore: validationResult.readabilityScore,
    schemaScore: validationResult.schemaScore,
    completenessScore: validationResult.completenessScore,
    fitScore: validationResult.fitScore,
    readinessScore: validationResult.readinessScore,
    missingValueRate: validationResult.missingValueRate,
    outlierRate: validationResult.outlierRate,
    warnings: validationResult.warnings,
    issues: validationResult.issues,
    deterministicRecommendation: validationResult.aiRecommendation,
    cleaningActions: validationResult.cleaningActions || [],
    detectedColumns: validationResult.detectedColumns || {},
    periodCheck: validationResult.periodCheck || {},
    modelReadiness: validationResult.modelReadiness || {},
    duplicateRowsRemoved: validationResult.duplicateRowsRemoved || 0
  };
  if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) return deterministic;

  const prompt = `You are Isuka's dataset quality reviewer. Review only these deterministic validation facts; do not invent facts or claim to have inspected raw rows. Check whether the selected year and season match the dataset values, whether columns fit the agricultural schema, whether duplicate rows were removed while keeping the latest occurrence, whether cleaning actions are safe, and whether the dataset is suitable for the forecasting and public dashboard models. Return JSON only with this exact shape: {"recommendation":"approve|needs_review|reject","summary":"string","readinessPercentage":0,"confidencePercentage":0,"details":{"reasons":["string"],"whyBlocked":["string"],"requiredChanges":["string"],"missingInformation":["string"],"systemChecks":["string"],"modelChecks":["string"],"cleaningActions":["string"],"publicationRisk":"low|medium|high"}}. Approve only when the deterministic recommendation is approve, the period check has no mismatch, and there are no material warnings. Never override a deterministic reject or fail. Explain exactly what is missing or invalid and what an administrator must correct.\nVALIDATION FACTS:\n${JSON.stringify(facts)}`;
  try {
    if (process.env.GEMINI_API_KEY) {
      const response = await fetchAIProvider(`https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || 'gemini-2.0-flash'}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } }),
      }, 'Gemini', 20000);
      if (!response.ok) throw createAIProviderResponseError('Gemini', response.status);
      const result = await response.json();
      const text = result.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('');
      return { ...parseDatasetReview(text, validationResult), provider: 'gemini' };
    }

    const response = await fetch(process.env.OPENAI_API_URL || 'https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', input: prompt, temperature: 0.1, text: { format: { type: 'json_object' } } }),
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error(`OpenAI returned ${response.status}.`);
    const result = await response.json();
    return { ...parseDatasetReview(result.output_text, validationResult), provider: 'openai' };
  } catch (error) {
    return { ...deterministic, details: { ...deterministic.details, providerError: error.message }, provider: 'deterministic_fallback' };
  }
}

async function saveAssistantMessage(userId, message, answer, conversationId = 'legacy', conversationTitle = 'Conversation') {
  const databaseCollections = await initializeDatabase();
  await databaseCollections.assistantMessages.insertOne({ userId, conversationId, conversationTitle, message, answer, createdAt: new Date() });
}

module.exports = { getWeather, askAssistant, reviewDatasetWithAI, saveAssistantMessage, fetchAIProvider };
