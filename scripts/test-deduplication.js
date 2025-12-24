/**
 * Standalone Test for Request Deduplication
 * 
 * This test verifies that the deduplication system prevents:
 * 1. Duplicate progress messages
 * 2. Duplicate error messages
 * 3. Error messages after successful completion
 */

// Load the compiled deduplication module
const { requestRegistry } = require('../dist/discord/requestDeduplication');

console.log('========================================');
console.log('🧪 Request Deduplication Tests');
console.log('========================================');

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    console.log(`\n🧪 TEST: ${name}`);
    fn();
    console.log(`✅ PASS: ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAIL: ${name}`);
    console.error(`  Error: ${error.message}`);
    testsFailed++;
  }
}

// Test 1: Single registration works
test('Single request registration', () => {
  requestRegistry.clear();
  const req = requestRegistry.register('test-001');
  if (!req) throw new Error('First registration should succeed');
  if (req.requestId !== 'test-001') throw new Error('RequestId mismatch');
  console.log('  ✓ First registration succeeded');
});

// Test 2: Duplicate registration is rejected (even after finalization)
test('Duplicate request is rejected even after finalization', () => {
  requestRegistry.clear();
  const req1 = requestRegistry.register('test-002');
  if (!req1) throw new Error('First registration should succeed');
  console.log('  ✓ First registration succeeded');
  
  // Finalize the request
  requestRegistry.finalize('test-002');
  console.log('  ✓ Request finalized');
  
  // Try to register again (simulates retry after quick failure)
  const req2 = requestRegistry.register('test-002');
  if (req2 !== null) throw new Error('Second registration should be rejected even though finalized');
  console.log('  ✓ Second registration rejected (correct - prevents duplicate progress messages)');
});

// Test 3: Progress message ID is stored
test('Progress message ID storage', () => {
  requestRegistry.clear();
  const req = requestRegistry.register('test-003');
  if (!req) throw new Error('Registration failed');
  
  requestRegistry.setProgressMessageId('test-003', 'msg-123');
  const stored = requestRegistry.get('test-003');
  if (stored.progressMessageId !== 'msg-123') {
    throw new Error('Progress message ID not stored correctly');
  }
  console.log('  ✓ Progress message ID stored correctly');
});

// Test 4: Finalization works
test('Request finalization', () => {
  requestRegistry.clear();
  const req = requestRegistry.register('test-004');
  if (!req) throw new Error('Registration failed');
  
  if (requestRegistry.isFinalized('test-004')) {
    throw new Error('Should not be finalized yet');
  }
  console.log('  ✓ Not finalized initially');
  
  requestRegistry.finalize('test-004');
  if (!requestRegistry.isFinalized('test-004')) {
    throw new Error('Should be finalized now');
  }
  console.log('  ✓ Finalized successfully');
});

// Test 5: Finalization prevents duplicate errors
test('Finalization prevents duplicate errors', () => {
  requestRegistry.clear();
  const req = requestRegistry.register('test-005');
  if (!req) throw new Error('Registration failed');
  
  // Simulate success path
  console.log('  ✓ Processing completed (success path)');
  requestRegistry.finalize('test-005');
  console.log('  ✓ Request finalized');
  
  // Simulate error in logging/cleanup
  console.log('  Simulating error thrown after success');
  
  // In real code, error handler checks isFinalized()
  if (requestRegistry.isFinalized('test-005')) {
    console.log('  ✓ Error handler skips sending message (correct)');
  } else {
    throw new Error('Error handler would send duplicate message');
  }
});

// Test 6: Multiple requests don't interfere
test('Multiple independent requests', () => {
  requestRegistry.clear();
  
  const req1 = requestRegistry.register('test-006-a');
  const req2 = requestRegistry.register('test-006-b');
  
  if (!req1 || !req2) throw new Error('Both registrations should succeed');
  console.log('  ✓ Two independent requests registered');
  
  requestRegistry.finalize('test-006-a');
  if (!requestRegistry.isFinalized('test-006-a')) {
    throw new Error('First request should be finalized');
  }
  if (requestRegistry.isFinalized('test-006-b')) {
    throw new Error('Second request should NOT be finalized');
  }
  console.log('  ✓ Independent finalization works correctly');
});

// Test 7: Final response tracking prevents error messages
test('Final response tracking prevents error messages', () => {
  requestRegistry.clear();
  const req = requestRegistry.register('test-007');
  if (!req) throw new Error('Registration failed');
  
  // Simulate successful completion
  console.log('  ✓ Processing completed (success path)');
  requestRegistry.setFinalResponseSent('test-007');
  
  if (!requestRegistry.hasFinalResponse('test-007')) {
    throw new Error('Should have final response flag set');
  }
  console.log('  ✓ Final response flag set');
  
  // Simulate error after success (e.g., in logging)
  console.log('  Simulating error thrown after success');
  
  // In real code, outer catch checks hasFinalResponse()
  if (requestRegistry.hasFinalResponse('test-007')) {
    console.log('  ✓ Outer catch skips sending error (correct)');
  } else {
    throw new Error('Outer catch would send duplicate error');
  }
  
  requestRegistry.finalize('test-007');
});

// Print results
console.log('\n========================================');
console.log(`📊 Results: ${testsPassed} passed, ${testsFailed} failed`);
console.log('========================================');

if (testsFailed === 0) {
  console.log('✅ All tests passed!');
  process.exit(0);
} else {
  console.log('❌ Some tests failed');
  process.exit(1);
}
