import assert from 'assert';
import { composePlannerUserPrompt } from '../src/jobs/planner';
import { composeCodegenUserPrompt } from '../src/jobs/codeGenerator';
import { WEBSITE_STYLE_AND_ASSETS_APPENDIX, enforceWebsiteAssets } from '../src/ai/websitePolicy';
import { ImprovedSpec, Plan } from '../src/jobs/types';

const baseSpec: ImprovedSpec = {
  title: 'Sample Landing Page',
  projectType: 'static_html',
  spec: 'Base spec content',
  output: {
    format: 'multi_file',
    primaryFile: 'index.html',
    notes: '',
  },
  acceptanceChecklist: ['Item A', 'Item B'],
};

const basePlan: Plan = {
  title: 'Sample Plan',
  projectType: 'static_html',
  buildStrategy: 'static',
  filePlan: [{ path: 'index.html', purpose: 'Main page', notes: '' }],
  steps: [
    {
      id: 'S1',
      name: 'Setup',
      goal: 'Prepare files',
      inputs: [],
      outputs: ['index.html'],
      risk: 'low',
      validation: ['index exists'],
    },
  ],
  acceptanceMapping: [{ checklistItem: 'Item A', coveredBySteps: ['S1'] }],
  guardrails: {
    noExternalAssets: true,
    singleShotUserFlow: true,
    noUserIteration: true,
    doNotAddFeaturesNotInSpec: true,
  },
};

(function testPlannerPromptAppendsAppendix() {
  const prompt = composePlannerUserPrompt(baseSpec, baseSpec.projectType, true);
  assert(prompt.includes(WEBSITE_STYLE_AND_ASSETS_APPENDIX), 'Planner prompt must include appendix');
  const specIndex = prompt.indexOf(baseSpec.spec);
  const appendixIndex = prompt.lastIndexOf(WEBSITE_STYLE_AND_ASSETS_APPENDIX);
  assert(appendixIndex > specIndex, 'Appendix should appear after spec content');
})();

(function testCodePromptAppendsAppendix() {
  const prompt = composeCodegenUserPrompt(baseSpec, basePlan, baseSpec.projectType, undefined, true);
  assert(prompt.includes(WEBSITE_STYLE_AND_ASSETS_APPENDIX), 'Code prompt must include appendix');
})();

(function testAssetEnforcementReplacesExternalUrls() {
  const files = enforceWebsiteAssets([
    {
      path: 'index.html',
      content: '<img src="https://example.com/img.jpg"><div style="background-image:url(https://example.com/bg.png)"></div>',
    },
  ]);

  const updated = files[0].content;
  assert(updated.includes('placehold.it'), 'External image URLs should be replaced with Placeholdit');
})();
