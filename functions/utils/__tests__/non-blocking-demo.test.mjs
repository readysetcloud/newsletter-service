import { jest } from '@jest/globals';

describe('Non-Blocking Momento Client Demo', () => {
  it('should demonstrat behavior', async () => {
    console.log('\n=== Non-Blocking Momento Client Demo ===\n');

    // Simulate a blocking operation (like the old approach)
    const blockingOperation = async () => {
      console.log('🔴 Blocking approach: Starting Momento token generation...');
      const start = Date.now();

      try {
        // Simulate a slow Momento API call that takes 5 seconds
        await new Promise((resolve, reject) => {
          setTimeout(() => reject(new Error('Momento timeout')), 5000);
        });
      } catch (error) {
        const duration = Date.now() - start;
        console.log(`🔴 Blocking approach: Failed after ${duration}ms - entire operation fails`);
        throw error;
      }
    };

    // Simulate a non-blocking operation (new approach)
    const nonBlockingOperation = async () => {
      console.log('🟢 Non-blocking approach: Starting Momento token generation...');
      const start = Date.now();

      try {
        // Use Promise.race to implement timeout
        const result = await Promise.race([
          // Simulate slow Momento API
          new Promise((resolve, reject) => {
            setTimeout(() => reject(new Error('Momento slow')), 5000);
          }),
          // Timeout after 2 seconds
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Operation timed out after 2000ms')), 2000);
          })
        ]);

        return result;
      } catch (error) {
        const duration = Date.now() - start;

        if (error.message.includes('timed out')) {
          console.log(`🟢 Non-blocking approach: Timed out after ${duration}ms - continuing without real-time features`);
          return null; // Graceful degradation
        } else {
          console.log(`🟢 Non-block
