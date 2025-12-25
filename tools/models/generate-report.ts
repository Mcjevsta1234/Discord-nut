import fs from 'fs';
import path from 'path';

const CACHE_DIR = path.join(__dirname, '../../.cache');
const OUTPUT_FILE = path.join(CACHE_DIR, 'model-pools-report.html');

interface ModelDetails {
  openRouterModelId: string;
  openRouterName: string;
  contextLength: number;
  codingScore: number;
  benchmarks: Record<string, number>;
  ranked: boolean;
  matchMethod: string;
  pricing?: {
    prompt: string;
    completion: string;
    request?: string;
    image?: string;
  };
  description?: string;
  architecture?: any;
  supported_parameters?: string[];
}

interface ModelPools {
  generatedAt: number;
  chosenDefaults: {
    bulkModel: string;
    pageModel: string;
    smallTasksModel: string;
  };
  tiers: Array<{
    name: string;
    description: string;
    models: string[];
  }>;
  models: ModelDetails[];
  namedAliases: Record<string, string>;
}

interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  context_length: number;
  pricing: {
    prompt: string;
    completion: string;
    request?: string;
    image?: string;
  };
  architecture?: any;
  supported_parameters?: string[];
}

function loadOpenRouterModels(): Record<string, OpenRouterModel> {
  const modelsFile = path.join(CACHE_DIR, 'openrouter-models.json');
  if (!fs.existsSync(modelsFile)) return {};
  
  const data = JSON.parse(fs.readFileSync(modelsFile, 'utf-8'));
  const map: Record<string, OpenRouterModel> = {};
  
  for (const model of data.models) {
    map[model.id] = model;
  }
  
  return map;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatJson(obj: any): string {
  return JSON.stringify(obj, null, 2);
}

function formatPricing(pricing: any): string {
  if (!pricing) return 'N/A';
  
  const promptCost = parseFloat(pricing.prompt || '0');
  const completionCost = parseFloat(pricing.completion || '0');
  const requestCost = pricing.request ? parseFloat(pricing.request) : 0;
  const imageCost = pricing.image ? parseFloat(pricing.image) : 0;
  
  const isFree = promptCost === 0 && completionCost === 0;
  
  let display = `<div class="pricing-details">`;
  
  if (isFree) {
    display += `<div class="pricing-free">🎉 FREE MODEL</div>`;
  } else {
    display += `<div class="pricing-paid">💰 Paid Model</div>`;
  }
  
  display += `<div class="pricing-breakdown">`;
  display += `<div class="pricing-item">
    <span class="pricing-label">Input (prompt):</span>
    <span class="pricing-value">${promptCost === 0 ? 'FREE' : `$${promptCost.toFixed(10)}/token`}</span>
  </div>`;
  display += `<div class="pricing-item">
    <span class="pricing-label">Output (completion):</span>
    <span class="pricing-value">${completionCost === 0 ? 'FREE' : `$${completionCost.toFixed(10)}/token`}</span>
  </div>`;
  
  if (requestCost > 0) {
    display += `<div class="pricing-item">
      <span class="pricing-label">Per request:</span>
      <span class="pricing-value">$${requestCost.toFixed(10)}/request</span>
    </div>`;
  }
  
  if (imageCost > 0) {
    display += `<div class="pricing-item">
      <span class="pricing-label">Per image:</span>
      <span class="pricing-value">$${imageCost.toFixed(10)}/image</span>
    </div>`;
  }
  
  // Show cost for typical usage
  if (!isFree) {
    const input1k = promptCost * 1000;
    const output1k = completionCost * 1000;
    display += `<div class="pricing-summary">
      <strong>Cost per 1K tokens:</strong><br>
      Input: $${input1k.toFixed(6)} | Output: $${output1k.toFixed(6)}
    </div>`;
  }
  
  display += `</div></div>`;
  return display;
}

function generateModelCard(model: ModelDetails, tier: string, rank: number, orModel?: OpenRouterModel): string {
  const tierColors: Record<string, string> = {
    LARGE: '#10b981',
    MEDIUM: '#3b82f6',
    SMALL: '#8b5cf6',
    UNRANKED: '#64748b'
  };
  
  const tierColor = tierColors[tier] || '#64748b';
  
  const pricingInfo = orModel?.pricing || model.pricing || {
    prompt: '0',
    completion: '0'
  };
  
  const benchmarksJson = formatJson(model.benchmarks);
  const pricingJson = formatJson(pricingInfo);
  const pricingDisplay = formatPricing(pricingInfo);
  const architectureJson = orModel?.architecture ? formatJson(orModel.architecture) : 'N/A';
  const parametersJson = orModel?.supported_parameters ? formatJson(orModel.supported_parameters) : 'N/A';
  
  return `
    <div class="model-card" data-tier="${tier}">
      <div class="model-header">
        <div class="model-rank" style="background: ${tierColor};">#${rank}</div>
        <div class="model-title">
          <h3>${escapeHtml(model.openRouterName)}</h3>
          <code class="model-id">${escapeHtml(model.openRouterModelId)}</code>
        </div>
        <div class="tier-badge" style="background: ${tierColor};">${tier}</div>
      </div>
      
      ${orModel?.description ? `
        <div class="model-description">
          ${escapeHtml(orModel.description)}
        </div>
      ` : ''}
      
      <div class="model-stats">
        <div class="stat">
          <span class="stat-label">Coding Score</span>
          <span class="stat-value" style="color: ${tierColor};">${(model.codingScore * 100).toFixed(1)}%</span>
        </div>
        <div class="stat">
          <span class="stat-label">Context Length</span>
          <span class="stat-value">${model.contextLength.toLocaleString()} tokens</span>
        </div>
        <div class="stat">
          <span class="stat-label">Match Method</span>
          <span class="stat-value">${model.matchMethod}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Ranked</span>
          <span class="stat-value">${model.ranked ? '✓ Yes' : '✗ No'}</span>
        </div>
      </div>
      
      <details class="json-section">
        <summary>📊 Benchmark Scores</summary>
        <pre><code>${escapeHtml(benchmarksJson)}</code></pre>
      </details>
      
      <details class="json-section" open>
        <summary>💰 Pricing Information</summary>
        ${pricingDisplay}
        <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1);">
          <strong>Raw JSON:</strong>
          <pre><code>${escapeHtml(pricingJson)}</code></pre>
        </div>
      </details>
      
      <details class="json-section">
        <summary>🏗️ Architecture</summary>
        <pre><code>${escapeHtml(architectureJson)}</code></pre>
      </details>
      
      <details class="json-section">
        <summary>⚙️ Supported Parameters</summary>
        <pre><code>${escapeHtml(parametersJson)}</code></pre>
      </details>
    </div>
  `;
}

export function generateHtmlReport(pools: ModelPools): string {
  const openRouterModels = loadOpenRouterModels();
  const reportPath = OUTPUT_FILE;
  
  // Build tier -> model mapping
  const modelTiers: Record<string, string> = {};
  for (const tier of pools.tiers) {
    for (const modelId of tier.models) {
      modelTiers[modelId] = tier.name;
    }
  }
  
  // Group models by tier
  const rankedModels = pools.models.filter(m => m.ranked);
  const unrankedModels = pools.models.filter(m => !m.ranked);
  
  let modelCardsHtml = '';
  let rank = 1;
  
  // Render ranked models by tier
  for (const tierName of ['LARGE', 'MEDIUM', 'SMALL']) {
    const tierModels = rankedModels.filter(m => modelTiers[m.openRouterModelId] === tierName);
    
    for (const model of tierModels) {
      const orModel = openRouterModels[model.openRouterModelId];
      modelCardsHtml += generateModelCard(model, tierName, rank++, orModel);
    }
  }
  
  // Render unranked models
  for (const model of unrankedModels) {
    const orModel = openRouterModels[model.openRouterModelId];
    modelCardsHtml += generateModelCard(model, 'UNRANKED', rank++, orModel);
  }
  
  const generatedDate = new Date(pools.generatedAt).toLocaleString();
  
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Model Pools Report - OpenRouter Free Models</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%);
      color: #e2e8f0;
      line-height: 1.6;
      padding: 2rem;
      min-height: 100vh;
    }
    
    .container {
      max-width: 1400px;
      margin: 0 auto;
    }
    
    header {
      text-align: center;
      padding: 3rem 0;
      margin-bottom: 3rem;
      background: rgba(255, 255, 255, 0.03);
      border-radius: 16px;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    h1 {
      font-size: 3rem;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 1rem;
    }
    
    .subtitle {
      color: #94a3b8;
      font-size: 1.2rem;
    }
    
    .defaults-section {
      background: rgba(16, 185, 129, 0.1);
      border: 2px solid rgba(16, 185, 129, 0.3);
      border-radius: 12px;
      padding: 2rem;
      margin-bottom: 3rem;
    }
    
    .defaults-section h2 {
      color: #10b981;
      margin-bottom: 1.5rem;
      font-size: 1.8rem;
    }
    
    .defaults-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1.5rem;
    }
    
    .default-item {
      background: rgba(0, 0, 0, 0.3);
      padding: 1.5rem;
      border-radius: 8px;
      border-left: 4px solid #10b981;
    }
    
    .default-label {
      color: #94a3b8;
      font-size: 0.9rem;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 0.5rem;
    }
    
    .default-value {
      color: #e2e8f0;
      font-family: 'Courier New', monospace;
      font-size: 1.1rem;
      word-break: break-all;
    }
    
    .stats-bar {
      display: flex;
      gap: 2rem;
      justify-content: center;
      margin-bottom: 3rem;
      flex-wrap: wrap;
    }
    
    .stat-box {
      background: rgba(255, 255, 255, 0.05);
      padding: 1.5rem 2.5rem;
      border-radius: 12px;
      text-align: center;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    .stat-box .number {
      font-size: 2.5rem;
      font-weight: bold;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    
    .stat-box .label {
      color: #94a3b8;
      font-size: 0.9rem;
      text-transform: uppercase;
      margin-top: 0.5rem;
    }
    
    .filters {
      display: flex;
      gap: 1rem;
      margin-bottom: 2rem;
      flex-wrap: wrap;
    }
    
    .filter-btn {
      padding: 0.75rem 1.5rem;
      border: 2px solid rgba(255, 255, 255, 0.2);
      background: rgba(255, 255, 255, 0.05);
      color: #e2e8f0;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.3s ease;
      font-size: 1rem;
    }
    
    .filter-btn:hover {
      border-color: #667eea;
      background: rgba(102, 126, 234, 0.1);
    }
    
    .filter-btn.active {
      border-color: #667eea;
      background: #667eea;
      color: white;
    }
    
    .models-grid {
      display: grid;
      gap: 2rem;
    }
    
    .model-card {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      padding: 2rem;
      transition: all 0.3s ease;
      backdrop-filter: blur(10px);
    }
    
    .model-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
      border-color: rgba(255, 255, 255, 0.2);
    }
    
    .model-header {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
    }
    
    .model-rank {
      width: 50px;
      height: 50px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 1.2rem;
      color: white;
      flex-shrink: 0;
    }
    
    .model-title {
      flex: 1;
      min-width: 200px;
    }
    
    .model-title h3 {
      color: #e2e8f0;
      font-size: 1.4rem;
      margin-bottom: 0.5rem;
    }
    
    .model-id {
      background: rgba(0, 0, 0, 0.4);
      padding: 0.4rem 0.8rem;
      border-radius: 6px;
      font-size: 0.85rem;
      color: #94a3b8;
      display: inline-block;
    }
    
    .tier-badge {
      padding: 0.5rem 1rem;
      border-radius: 8px;
      color: white;
      font-weight: bold;
      font-size: 0.9rem;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    
    .model-description {
      color: #94a3b8;
      margin-bottom: 1.5rem;
      padding: 1rem;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 8px;
      border-left: 3px solid rgba(102, 126, 234, 0.5);
    }
    
    .model-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    
    .stat {
      background: rgba(0, 0, 0, 0.3);
      padding: 1rem;
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    
    .stat-label {
      color: #64748b;
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .stat-value {
      color: #e2e8f0;
      font-size: 1.2rem;
      font-weight: 600;
    }
    
    .json-section {
      margin-top: 1rem;
      background: rgba(0, 0, 0, 0.4);
      border-radius: 8px;
      overflow: hidden;
    }
    
    .json-section summary {
      padding: 1rem;
      cursor: pointer;
      user-select: none;
      font-weight: 600;
      color: #a5b4fc;
      transition: all 0.3s ease;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    
    .json-section summary:hover {
      background: rgba(102, 126, 234, 0.1);
    }
    
    .json-section pre {
      padding: 1.5rem;
      overflow-x: auto;
      background: #0f172a;
      margin: 0;
    }
    
    .json-section code {
     
    
    .pricing-details {
      padding: 1rem;
      background: rgba(0, 0, 0, 0.3);
      border-radius: 8px;
    }
    
    .pricing-free {
      color: #10b981;
      font-size: 1.2rem;
      font-weight: bold;
      text-align: center;
      padding: 1rem;
      background: rgba(16, 185, 129, 0.1);
      border-radius: 8px;
      margin-bottom: 1rem;
    }
    
    .pricing-paid {
      color: #f59e0b;
      font-size: 1.2rem;
      font-weight: bold;
      text-align: center;
      padding: 1rem;
      background: rgba(245, 158, 11, 0.1);
      border-radius: 8px;
      margin-bottom: 1rem;
    }
    
    .pricing-breakdown {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    
    .pricing-item {
      display: flex;
      justify-content: space-between;
      padding: 0.75rem;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 6px;
    }
    
    .pricing-label {
      color: #94a3b8;
      font-weight: 500;
    }
    
    .pricing-value {
      color: #e2e8f0;
      font-family: 'Courier New', monospace;
      font-weight: 600;
    }
    
    .pricing-summary {
      margin-top: 1rem;
      padding: 1rem;
      background: rgba(102, 126, 234, 0.1);
      border-radius: 6px;
      border-left: 3px solid #667eea;
      color: #a5b4fc;
    } color: #e879f9;
      font-family: 'Courier New', monospace;
      font-size: 0.9rem;
      line-height: 1.8;
    }
    
    footer {
      text-align: center;
      margin-top: 4rem;
      padding: 2rem;
      color: #64748b;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    @media (max-width: 768px) {
      body {
        padding: 1rem;
      }
      
      h1 {
        font-size: 2rem;
      }
      
      .model-header {
        flex-direction: column;
        align-items: flex-start;
      }
      
      .tier-badge {
        align-self: flex-start;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🤖 Model Pools Report</h1>
      <p class="subtitle">OpenRouter Free Models - Ranked by Coding Performance</p>
      <p class="subtitle" style="font-size: 0.9rem; margin-top: 0.5rem;">Generated: ${generatedDate}</p>
    </header>
    
    <div class="defaults-section">
      <h2>🎯 Chosen Defaults</h2>
      <div class="defaults-grid">
        <div class="default-item">
          <div class="default-label">Bulk Model (Phase 0)</div>
          <div class="default-value">${escapeHtml(pools.chosenDefaults.bulkModel)}</div>
        </div>
        <div class="default-item">
          <div class="default-label">Page Model (Phase 1)</div>
          <div class="default-value">${escapeHtml(pools.chosenDefaults.pageModel)}</div>
        </div>
        <div class="default-item">
          <div class="default-label">Small Tasks Model</div>
          <div class="default-value">${escapeHtml(pools.chosenDefaults.smallTasksModel)}</div>
        </div>
      </div>
    </div>
    
    <div class="stats-bar">
      <div class="stat-box">
        <div class="number">${pools.models.length}</div>
        <div class="label">Total Models</div>
      </div>
      <div class="stat-box">
        <div class="number">${rankedModels.length}</div>
        <div class="label">Ranked</div>
      </div>
      <div class="stat-box">
        <div class="number">${pools.tiers.find(t => t.name === 'LARGE')?.models.length || 0}</div>
        <div class="label">LARGE Tier</div>
      </div>
      <div class="stat-box">
        <div class="number">${pools.tiers.find(t => t.name === 'MEDIUM')?.models.length || 0}</div>
        <div class="label">MEDIUM Tier</div>
      </div>
      <div class="stat-box">
        <div class="number">${pools.tiers.find(t => t.name === 'SMALL')?.models.length || 0}</div>
        <div class="label">SMALL Tier</div>
      </div>
    </div>
    
    <div class="filters">
      <button class="filter-btn active" data-filter="all">All Models</button>
      <button class="filter-btn" data-filter="LARGE">LARGE Tier</button>
      <button class="filter-btn" data-filter="MEDIUM">MEDIUM Tier</button>
      <button class="filter-btn" data-filter="SMALL">SMALL Tier</button>
      <button class="filter-btn" data-filter="UNRANKED">Unranked</button>
    </div>
    
    <div class="models-grid">
      ${modelCardsHtml}
    </div>
    
    <footer>
      <p>Generated by discord-nut model pools system</p>
      <p style="margin-top: 0.5rem;">Free models from OpenRouter API • Ranked by coding benchmark scores</p>
    </footer>
  </div>
  
  <script>
    // Filter functionality
    const filterButtons = document.querySelectorAll('.filter-btn');
    const modelCards = document.querySelectorAll('.model-card');
    
    filterButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const filter = btn.dataset.filter;
        
        // Update active button
        filterButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Filter cards
        modelCards.forEach(card => {
          if (filter === 'all' || card.dataset.tier === filter) {
            card.style.display = 'block';
          } else {
            card.style.display = 'none';
          }
        });
      });
    });
  </script>
</body>
</html>`;
  
  fs.writeFileSync(reportPath, html);
  console.log(`\n✓ Generated HTML report: ${reportPath}`);
  
  // Auto-open in browser
  try {
    const { exec } = require('child_process');
    const command = process.platform === 'win32' ? 'start' : 
                   process.platform === 'darwin' ? 'open' : 'xdg-open';
    exec(`${command} "${reportPath}"`, (error: any) => {
      if (error) {
        console.log(`  ⓘ To view: open ${reportPath}`);
      } else {
        console.log(`  ✓ Opened in browser`);
      }
    });
  } catch (error) {
    console.log(`  ⓘ To view: open ${reportPath}`);
  }
  
  return reportPath;
}
