// Mock Kafka producer and consumer
jest.mock('kafkajs', () => {
  const mockSend = jest.fn().mockResolvedValue(true);
  const mockConnect = jest.fn().mockResolvedValue(true);
  const mockDisconnect = jest.fn().mockResolvedValue(true);
  const mockSubscribe = jest.fn().mockResolvedValue(true);
  const mockRun = jest.fn().mockResolvedValue(true);

  return {
    Kafka: jest.fn().mockImplementation(() => {
      return {
        producer: jest.fn().mockImplementation(() => {
          return {
            connect: mockConnect,
            disconnect: mockDisconnect,
            send: mockSend,
          };
        }),
        consumer: jest.fn().mockImplementation(() => {
          return {
            connect: mockConnect,
            disconnect: mockDisconnect,
            subscribe: mockSubscribe,
            run: mockRun,
          };
        }),
      };
    }),
  };
});
