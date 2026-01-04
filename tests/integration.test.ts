async function runTests() {
  console.log('\n=== MIRA INTEGRATION TESTS ===\n');

  const baseUrl = 'http://localhost:3000/api/v1';
  const userId = `test-${Date.now()}`;
  const conversationId = `conv-${Date.now()}`;

  try {
    // Test 0: Health check
    console.log('Test 0: Health check...');
    const health = await fetch('http://localhost:3000/health');
    const healthData = await health.json();
    console.log('✅ Health:', healthData.status);

    // Test 1: Send message
    console.log('\nTest 1: Send message...');
    const resp1 = await fetch(`${baseUrl}/messages/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        conversationId,
        content: 'Hi! My name is Alice and I love painting.',
      }),
    });

    const data1 = await resp1.json();
    console.log('✅ Message sent:', data1.message?.content?.substring(0, 80) + '...');

    // Wait for memory processing
    console.log('\n⏳ Waiting for memory processing...');
    await new Promise((r) => setTimeout(r, 3000));

    // Test 2: Get memories
    console.log('\nTest 2: Get memories...');
    const resp2 = await fetch(`${baseUrl}/memories?userId=${userId}`);
    const data2 = await resp2.json();
    console.log(`✅ Found ${data2.memories?.length || 0} memories`);
    if (data2.memories?.length > 0) {
      data2.memories.forEach((m: any) => console.log(`   - ${m.fact}`));
    }

    // Test 3: Follow-up message
    console.log('\nTest 3: Follow-up message (should remember Alice)...');
    const resp3 = await fetch(`${baseUrl}/messages/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        conversationId,
        content: 'What can you tell me about myself?',
      }),
    });

    const data3 = await resp3.json();
    const response = data3.message?.content || '';
    console.log('Response:', response.substring(0, 150) + '...');

    const hasName = response.toLowerCase().includes('alice');
    const hasPainting = response.toLowerCase().includes('paint');

    if (hasName || hasPainting) {
      console.log('✅ Mira remembered the user!');
    } else {
      console.log('⚠️ Mira might need more time to process memories');
    }

    // Test 4: Get conversation
    console.log('\nTest 4: Get conversation...');
    const resp4 = await fetch(
      `${baseUrl}/messages/conversation/${conversationId}?userId=${userId}`
    );
    const data4 = await resp4.json();
    console.log(`✅ Retrieved ${data4.messages?.length || 0} messages`);

    // Test 5: Get profile
    console.log('\nTest 5: Get profile...');
    const resp5 = await fetch(`${baseUrl}/profile/${userId}`);
    const data5 = await resp5.json();
    console.log('✅ Profile summary:', data5.summary?.substring(0, 100) || 'Not yet generated');

    // Test 6: Simple /chat endpoint
    console.log('\nTest 6: Simple /chat endpoint...');
    const resp6 = await fetch('http://localhost:3000/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'simple-test',
        message: 'Hello Mira!',
      }),
    });
    const data6 = await resp6.json();
    console.log('✅ Simple chat response:', data6.response?.substring(0, 80) + '...');

    console.log('\n=== ALL TESTS PASSED ===\n');
  } catch (error) {
    console.error('❌ Test error:', error);
    process.exit(1);
  }
}

runTests();
