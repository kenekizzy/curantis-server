import { SocketGateway } from './socket.gateway.js';

// 🔌 What is this file checking?
// This is the live chat "front door" — it runs the moment someone's
// browser opens a WebSocket connection, and for every chat action they
// take afterwards (join a conversation, send a message, start typing...).
// We fake the WebSocket connection itself (the `client` and `server`
// objects) so we can check the gateway's own decisions without needing
// a real network socket:
//   - no token, or a fake/expired token → disconnect immediately
//   - a real token → mark them "online" and let them in
//   - every chat action still re-checks "are you actually allowed in
//     THIS conversation?" before doing anything

process.env.JWT_PUBLIC_KEY = 'fake-public-key';

describe('SocketGateway', () => {
  function buildGateway() {
    const jwtService = { verify: jest.fn() } as any;
    const redis = { setex: jest.fn(), del: jest.fn() } as any;
    const chatService = {
      canAccess: jest.fn(),
      getHistory: jest.fn(),
      markRead: jest.fn(),
      persistMessage: jest.fn(),
    } as any;
    const gateway = new SocketGateway(jwtService, redis, chatService);
    gateway.server = { emit: jest.fn(), to: jest.fn().mockReturnValue({ emit: jest.fn() }) } as any;
    return { gateway, jwtService, redis, chatService };
  }

  function buildClient(overrides: Record<string, unknown> = {}) {
    return {
      handshake: { auth: { token: 'a-token' } },
      data: {},
      join: jest.fn(),
      disconnect: jest.fn(),
      emit: jest.fn(),
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
      ...overrides,
    } as any;
  }

  describe('handleConnection', () => {
    it('disconnects immediately when no token was sent at all', async () => {
      // Why: no token means we can't know who this is — refuse the connection.
      const { gateway } = buildGateway();
      const client = buildClient({ handshake: { auth: {} } });

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalled();
    });

    it('disconnects when the token fails verification (fake or expired)', async () => {
      const { gateway, jwtService } = buildGateway();
      jwtService.verify.mockImplementation(() => {
        throw new Error('invalid signature');
      });
      const client = buildClient();

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalled();
    });

    it('joins the user\'s personal room and marks them online when the token is valid', async () => {
      const { gateway, jwtService, redis } = buildGateway();
      jwtService.verify.mockReturnValue({ sub: 'user-1', role: 'CLIENT' });
      const client = buildClient();

      await gateway.handleConnection(client);

      expect(client.join).toHaveBeenCalledWith('user:user-1');
      expect(redis.setex).toHaveBeenCalledWith('presence:user-1', 90, 'online');
      expect(gateway.server.emit).toHaveBeenCalledWith('chat:presence', {
        userId: 'user-1',
        status: 'online',
      });
    });
  });

  describe('handleDisconnect', () => {
    it('does nothing if the client never actually authenticated', async () => {
      const { gateway, redis } = buildGateway();
      const client = buildClient({ data: {} });

      await gateway.handleDisconnect(client);

      expect(redis.del).not.toHaveBeenCalled();
    });

    it('clears presence and broadcasts "offline" for a real, connected user', async () => {
      const { gateway, redis } = buildGateway();
      const client = buildClient({ data: { userId: 'user-1' } });

      await gateway.handleDisconnect(client);

      expect(redis.del).toHaveBeenCalledWith('presence:user-1');
      expect(gateway.server.emit).toHaveBeenCalledWith('chat:presence', {
        userId: 'user-1',
        status: 'offline',
      });
    });
  });

  describe('handleJoin', () => {
    it('refuses to join a conversation the user is not allowed into', async () => {
      const { gateway, chatService } = buildGateway();
      chatService.canAccess.mockResolvedValue(false);
      const client = buildClient({ data: { userId: 'user-1' } });

      const result = await gateway.handleJoin(client, { conversationId: 'conv-1' });

      expect(result).toEqual({ error: 'FORBIDDEN' });
      expect(client.join).not.toHaveBeenCalled();
    });

    it('joins the room, sends chat history, and marks messages read when allowed', async () => {
      const { gateway, chatService } = buildGateway();
      chatService.canAccess.mockResolvedValue(true);
      chatService.getHistory.mockResolvedValue([{ id: 'm1' }]);
      const client = buildClient({ data: { userId: 'user-1' } });

      const result = await gateway.handleJoin(client, { conversationId: 'conv-1' });

      expect(client.join).toHaveBeenCalledWith('conv:conv-1');
      expect(client.emit).toHaveBeenCalledWith('chat:history', { messages: [{ id: 'm1' }] });
      expect(chatService.markRead).toHaveBeenCalledWith('conv-1', 'user-1');
      expect(result).toBeUndefined();
    });
  });

  describe('handleSend', () => {
    it('refuses to send a message into a conversation the user cannot access', async () => {
      const { gateway, chatService } = buildGateway();
      chatService.canAccess.mockResolvedValue(false);
      const client = buildClient({ data: { userId: 'user-1' } });

      const result = await gateway.handleSend(client, { conversationId: 'conv-1', text: 'hi' });

      expect(result).toEqual({ error: 'FORBIDDEN' });
      expect(chatService.persistMessage).not.toHaveBeenCalled();
    });

    it('saves the message, broadcasts it to the room, and acknowledges the sender', async () => {
      const { gateway, chatService } = buildGateway();
      chatService.canAccess.mockResolvedValue(true);
      chatService.persistMessage.mockResolvedValue({ id: 'm1', createdAt: new Date('2026-01-01') });
      const client = buildClient({ data: { userId: 'user-1' } });
      const roomEmit = jest.fn();
      gateway.server.to = jest.fn().mockReturnValue({ emit: roomEmit });

      await gateway.handleSend(client, { conversationId: 'conv-1', text: 'hi' });

      expect(gateway.server.to).toHaveBeenCalledWith('conv:conv-1');
      expect(roomEmit).toHaveBeenCalledWith('chat:message', { message: { id: 'm1', createdAt: new Date('2026-01-01') } });
      expect(client.emit).toHaveBeenCalledWith('chat:message:ack', {
        messageId: 'm1',
        sentAt: new Date('2026-01-01'),
      });
    });
  });

  describe('handleHeartbeat', () => {
    it('refreshes the 90-second presence TTL in Redis', async () => {
      const { gateway, redis } = buildGateway();
      const client = buildClient({ data: { userId: 'user-1' } });

      await gateway.handleHeartbeat(client);

      expect(redis.setex).toHaveBeenCalledWith('presence:user-1', 90, 'online');
    });
  });
});
