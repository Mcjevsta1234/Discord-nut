import { MinecraftStatusTool } from './mcp/tools/minecraftStatus';

async function test() {
  console.log('🧪 Testing Minecraft Status Tool\n');
  
  const tool = new MinecraftStatusTool();
  
  console.log('📝 Calling tool with no parameters (should check default servers)...\n');
  const result = await tool.execute({});
  
  console.log('📊 Result:');
  console.log('  Success:', result.success);
  console.log('  Data type:', typeof result.data);
  console.log('  Data length:', result.data?.toString().length || 0);
  console.log('\n📄 Full Data:');
  console.log(result.data);
  console.log('\n✅ Test complete');
}

test().catch(console.error);
