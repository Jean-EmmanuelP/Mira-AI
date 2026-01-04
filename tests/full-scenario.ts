async function fullScenario() {
  console.log('\n=== FULL MIRA SCENARIO TEST ===\n');

  const baseUrl = 'http://localhost:3000/api/v1';
  const userId = 'scenario-test-' + Date.now();
  const conversationId = 'conv-' + Date.now();

  try {
    // Day 1: Introduction
    console.log('📝 Day 1: User introduces themselves\n');

    const msg1 = await sendMessage(
      baseUrl,
      userId,
      conversationId,
      'Hi Mira! My name is Sarah. I am a dentist and I love rock climbing.'
    );
    console.log('Mira:', msg1.substring(0, 100) + '...\n');

    await sleep(3000);

    // Day 2: Return
    console.log('📝 Day 2: User returns\n');

    const msg2 = await sendMessage(baseUrl, userId, conversationId, 'Hi! How are you?');
    console.log('Mira:', msg2.substring(0, 100) + '...\n');

    if (
      msg2.toLowerCase().includes('sarah') ||
      msg2.toLowerCase().includes('dentist') ||
      msg2.toLowerCase().includes('climbing')
    ) {
      console.log('✅ Mira remembered Sarah!\n');
    }

    // Day 3: Share a goal
    console.log('📝 Day 3: Share a goal\n');

    const msg3 = await sendMessage(
      baseUrl,
      userId,
      conversationId,
      'I want to climb Mount Kilimanjaro next year. Wish me luck!'
    );
    console.log('Mira:', msg3.substring(0, 100) + '...\n');

    await sleep(2000);

    // Day 4: Tough day
    console.log('📝 Day 4: Tough day at work\n');

    const msg4 = await sendMessage(
      baseUrl,
      userId,
      conversationId,
      'Just had a tough day at work. Really need to relax.'
    );
    console.log('Mira:', msg4.substring(0, 100) + '...\n');

    // Check stats
    const memoriesResp = await fetch(`${baseUrl}/memories?userId=${userId}`);
    const memoriesData = await memoriesResp.json();

    const profileResp = await fetch(`${baseUrl}/profile/${userId}`);
    const profileData = await profileResp.json();

    console.log(`\n📊 Stats:`);
    console.log(`- Messages: 4`);
    console.log(`- Memories stored: ${memoriesData.memories?.length || 0}`);
    console.log(`- Goals detected: ${profileData.goals?.length || 0}`);
    console.log(`- Profile: ${profileData.summary?.substring(0, 100) || 'Generating...'}`);

    console.log('\n✅ Full scenario test complete!\n');
  } catch (error) {
    console.error('❌ Scenario test failed:', error);
  }
}

async function sendMessage(
  baseUrl: string,
  userId: string,
  conversationId: string,
  content: string
): Promise<string> {
  const response = await fetch(`${baseUrl}/messages/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, conversationId, content }),
  });

  const data = await response.json();
  return data.message?.content || '';
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

fullScenario();
