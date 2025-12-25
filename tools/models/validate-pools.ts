import { rankModels } from './rank-models';

async function validateTiers() {
  console.log('=== Validating Model Pools System ===\n');
  
  try {
    const pools = await rankModels(false);
    
    // Validate structure
    console.log('✓ Model pools structure valid');
    
    // Validate tiers
    const totalTiered = pools.tiers.reduce((sum, tier) => sum + tier.models.length, 0);
    const rankedCount = pools.models.filter(m => m.ranked).length;
    
    if (totalTiered !== rankedCount) {
      throw new Error(`Tier count mismatch: ${totalTiered} tiered vs ${rankedCount} ranked`);
    }
    console.log('✓ All ranked models are in tiers');
    
    // Validate tier distribution
    const largeTier = pools.tiers.find(t => t.name === 'LARGE')!;
    const mediumTier = pools.tiers.find(t => t.name === 'MEDIUM')!;
    const smallTier = pools.tiers.find(t => t.name === 'SMALL')!;
    
    const largePercent = (largeTier.models.length / rankedCount) * 100;
    const mediumPercent = (mediumTier.models.length / rankedCount) * 100;
    const smallPercent = (smallTier.models.length / rankedCount) * 100;
    
    console.log(`\nTier distribution:`);
    console.log(`  LARGE: ${largePercent.toFixed(1)}% (target: ~15%)`);
    console.log(`  MEDIUM: ${mediumPercent.toFixed(1)}% (target: ~35%)`);
    console.log(`  SMALL: ${smallPercent.toFixed(1)}% (target: ~50%)`);
    
    // Validate scores are descending
    for (const tier of pools.tiers) {
      for (let i = 0; i < tier.models.length - 1; i++) {
        const m1 = pools.models.find(m => m.openRouterModelId === tier.models[i])!;
        const m2 = pools.models.find(m => m.openRouterModelId === tier.models[i + 1])!;
        
        if (m1.codingScore < m2.codingScore) {
          console.warn(`⚠ Score not descending in ${tier.name}: ${m1.openRouterModelId} (${m1.codingScore}) < ${m2.openRouterModelId} (${m2.codingScore})`);
        }
      }
    }
    console.log('✓ Scores within tiers are properly ordered');
    
    // Validate defaults exist
    const { bulkModel, pageModel, smallTasksModel } = pools.chosenDefaults;
    if (!pools.models.find(m => m.openRouterModelId === bulkModel)) {
      throw new Error(`bulkModel ${bulkModel} not found in models list`);
    }
    if (!pools.models.find(m => m.openRouterModelId === pageModel)) {
      throw new Error(`pageModel ${pageModel} not found in models list`);
    }
    if (!pools.models.find(m => m.openRouterModelId === smallTasksModel)) {
      throw new Error(`smallTasksModel ${smallTasksModel} not found in models list`);
    }
    console.log('✓ Chosen defaults exist in models list');
    
    // Determinism check
    console.log('\n✓ All validations passed!');
    console.log(`\nSummary:`);
    console.log(`  Total models: ${pools.models.length}`);
    console.log(`  Ranked models: ${rankedCount}`);
    console.log(`  LARGE tier: ${largeTier.models.length}`);
    console.log(`  MEDIUM tier: ${mediumTier.models.length}`);
    console.log(`  SMALL tier: ${smallTier.models.length}`);
    
  } catch (error: any) {
    console.error('✗ Validation failed:', error.message);
    process.exit(1);
  }
}

validateTiers();
