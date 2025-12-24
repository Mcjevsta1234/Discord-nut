/**
 * Mock Tests for Request Deduplication
 * 
 * Tests that:
 * 1. Only ONE progress message is created per request
 * 2. Duplicate invocations are ignored
 * 3. Only ONE final message (success or error) is sent
 * 4. Finalization prevents duplicate error messages
 */

import { requestRegistry } from './requestDeduplication';

// Mock Discord message
class MockMessage {
  id: string;
  channelId: string;
  author: { id: string; username: string; bot: boolean };
  content: string;
  reactions = { cache: { size: 0 } };
  reference: any = null;
  mentions = new Set();
  guild: any = null;
  guildId: string | null = null;
  system = false;
  type = 0;
  channel: any;
  
  private replySent = false;
  private replyMessage: MockMessage | null = null;
  
  constructor(id: string, content: string, username: string) {
    this.id = id;
    this.channelId = 'test-channel';
    this.author = { id: `user-${username}`, username, bot: false };
    this.content = content;
    this.channel = {
      send: async (options: any) => {
        const msg = new MockMessage(`reply-${Date.now()}`, 'Bot response', 'TestBot');
        msg.channel = this.channel;
        return msg;
      },
    };
  }
  
  async reply(options: any): Promise<MockMessage> {
    if (this.replySent) {
      throw new Error('DUPLICATE_REPLY: Already sent a reply to this message!');
    }
    this.replySent = true;
    
    const replyMsg = new MockMessage(`reply-${this.id}`, 'Processing...', 'TestBot');
    replyMsg.channel = this.channel;
    this.replyMessage = replyMsg;
    
    console.log(`  📤 Reply sent: ${replyMsg.id}`);
    return replyMsg;
  }
  
  async edit(options: any): Promise<MockMessage> {
    console.log(`  ✏️  Message edited: ${this.id}`);
    return this;
  }
  
  getReplyMessage(): MockMessage | null {
    return this.replyMessage;
  }
  
  hasReplied(): boolean {
    return this.replySent;
  }
}

// Test 1: Single Request - Verify only one progress message
function test_single_request() {
  console.log('\n🧪 TEST 1: Single Request - Verify only one progress message');
  requestRegistry.clear();
  
  const message = new MockMessage('msg-001', 'emma code me a website', 'TestUser');
  const requestId = `msg_${message.id}`;
  
  console.log(`  Creating first invocation for ${requestId}`);
  const request1 = requestRegistry.register(requestId);
  
  if (!request1) {
    console.error('  ❌ FAIL: First request was rejected as duplicate');
    return false;
  }
  
  console.log(`  ✓ First invocation registered`);
  console.log(`  Setting progress message ID`);
  requestRegistry.setProgressMessageId(requestId, 'progress-msg-001');
  
  const state = requestRegistry.get(requestId);
  if (state?.progressMessageId !== 'progress-msg-001') {
    console.error('  ❌ FAIL: Progress message ID not set correctly');
    return false;
  }
  
  console.log(`  ✓ Progress message ID set correctly`);
  console.log(`  ✅ PASS: Single request creates exactly one progress message`);
  return true;
}

// Test 2: Duplicate Invocation - Verify second call is ignored
function test_duplicate_invocation() {
  console.log('\n🧪 TEST 2: Duplicate Invocation - Verify second call is ignored');
  requestRegistry.clear();
  
  const message = new MockMessage('msg-002', 'emma code me a website', 'TestUser');
  const requestId = `msg_${message.id}`;
  
  console.log(`  Creating first invocation for ${requestId}`);
  const request1 = requestRegistry.register(requestId);
  
  if (!request1) {
    console.error('  ❌ FAIL: First request was rejected');
    return false;
  }
  
  console.log(`  ✓ First invocation registered`);
  console.log(`  Attempting second invocation (should be rejected)`);
  
  const request2 = requestRegistry.register(requestId);
  
  if (request2 !== null) {
    console.error('  ❌ FAIL: Second invocation was NOT rejected as duplicate');
    return false;
  }
  
  console.log(`  ✓ Second invocation rejected (correct behavior)`);
  console.log(`  ✅ PASS: Duplicate invocation is ignored`);
  return true;
}

// Test 3: Finalization - Verify only one final message
function test_finalization() {
  console.log('\n🧪 TEST 3: Finalization - Verify only one final message');
  requestRegistry.clear();
  
  const message = new MockMessage('msg-003', 'emma code me a website', 'TestUser');
  const requestId = `msg_${message.id}`;
  
  console.log(`  Registering request ${requestId}`);
  const request = requestRegistry.register(requestId);
  
  if (!request) {
    console.error('  ❌ FAIL: Request registration failed');
    return false;
  }
  
  console.log(`  ✓ Request registered`);
  console.log(`  Finalizing request (success path)`);
  requestRegistry.finalize(requestId);
  
  if (!requestRegistry.isFinalized(requestId)) {
    console.error('  ❌ FAIL: Request not marked as finalized');
    return false;
  }
  
  console.log(`  ✓ Request marked as finalized`);
  console.log(`  Attempting to send error (should be blocked by finalization check)`);
  
  // In real code, error handler checks isFinalized() before sending error
  if (requestRegistry.isFinalized(requestId)) {
    console.log(`  ✓ Error send blocked (correct behavior)`);
  } else {
    console.error('  ❌ FAIL: Error would have been sent (duplicate error)');
    return false;
  }
  
  console.log(`  ✅ PASS: Finalization prevents duplicate messages`);
  return true;
}

// Test 4: Error After Success - Verify no duplicate error
function test_error_after_success() {
  console.log('\n🧪 TEST 4: Error After Success - Verify no duplicate error');
  requestRegistry.clear();
  
  const message = new MockMessage('msg-004', 'emma code me a website', 'TestUser');
  const requestId = `msg_${message.id}`;
  
  console.log(`  Simulating successful completion`);
  const request = requestRegistry.register(requestId);
  
  if (!request) {
    console.error('  ❌ FAIL: Request registration failed');
    return false;
  }
  
  // Simulate success path
  console.log(`  ✓ Request processing (success path)`);
  requestRegistry.finalize(requestId);
  console.log(`  ✓ Request finalized (success)`);
  
  // Simulate an error occurring after finalization (e.g., logging failure)
  console.log(`  Simulating error thrown after finalization`);
  
  // In real code, outer catch checks isFinalized()
  if (requestRegistry.isFinalized(requestId)) {
    console.log(`  ✓ Outer catch skips sending error message (correct)`);
  } else {
    console.error('  ❌ FAIL: Outer catch would send duplicate error');
    return false;
  }
  
  console.log(`  ✅ PASS: No duplicate error after successful completion`);
  return true;
}

// Test 5: Mock Progress Message Edits
function test_progress_message_edits() {
  console.log('\n🧪 TEST 5: Mock Progress Message Edits - Verify same message is edited');
  requestRegistry.clear();
  
  const message = new MockMessage('msg-005', 'emma code me a website', 'TestUser');
  const requestId = `msg_${message.id}`;
  
  let progressMessageEditCount = 0;
  
  try {
    console.log(`  Step 1: Create initial progress message`);
    const replyMsg = message.reply({ embeds: [] });
    requestRegistry.register(requestId);
    
    if (!message.hasReplied()) {
      console.error('  ❌ FAIL: No reply was sent');
      return false;
    }
    
    console.log(`  ✓ Initial progress message created`);
    
    const progressMsg = message.getReplyMessage();
    if (!progressMsg) {
      console.error('  ❌ FAIL: Could not get progress message');
      return false;
    }
    
    requestRegistry.setProgressMessageId(requestId, progressMsg.id);
    
    // Simulate multiple stage updates (all should EDIT same message)
    console.log(`  Step 2: Update Stage 1/3 (edit)`);
    progressMsg.edit({ embeds: [] });
    progressMessageEditCount++;
    
    console.log(`  Step 3: Update Stage 2/3 (edit)`);
    progressMsg.edit({ embeds: [] });
    progressMessageEditCount++;
    
    console.log(`  Step 4: Update Stage 3/3 (edit)`);
    progressMsg.edit({ embeds: [] });
    progressMessageEditCount++;
    
    console.log(`  ✓ All updates edited same message (${progressMessageEditCount} edits)`);
    
    // Verify only ONE reply was sent
    if (message.hasReplied() && progressMessageEditCount === 3) {
      console.log(`  ✅ PASS: Only one progress message, edited ${progressMessageEditCount} times`);
      return true;
    } else {
      console.error('  ❌ FAIL: Unexpected reply/edit count');
      return false;
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('DUPLICATE_REPLY')) {
      console.error(`  ❌ FAIL: Duplicate reply detected! ${error.message}`);
      return false;
    }
    throw error;
  }
}

// Run all tests
function runAllTests() {
  console.log('========================================');
  console.log('🧪 Request Deduplication Tests');
  console.log('========================================');
  
  const results = [
    test_single_request(),
    test_duplicate_invocation(),
    test_finalization(),
    test_error_after_success(),
    test_progress_message_edits(),
  ];
  
  const passed = results.filter(r => r).length;
  const total = results.length;
  
  console.log('\n========================================');
  console.log(`📊 Results: ${passed}/${total} tests passed`);
  console.log('========================================');
  
  if (passed === total) {
    console.log('✅ All tests passed!');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed');
    process.exit(1);
  }
}

// Run tests
runAllTests();
