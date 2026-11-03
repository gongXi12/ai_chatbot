import type { Pool } from 'pg';
import type { OutboundDelivery, OutboundDeliveryRepository } from './OutboundDeliveryRepository.js';

export class PostgresOutboundDeliveryRepository implements OutboundDeliveryRepository {
  constructor(private readonly pool: Pool) {}

  async isDelivered(deliveryId: string): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM outbound_deliveries WHERE delivery_id = $1',
      [deliveryId],
    );
    return result.rowCount === 1;
  }

  async markDelivered(delivery: OutboundDelivery): Promise<void> {
    await this.pool.query(
      `INSERT INTO outbound_deliveries (
         delivery_id, user_id, channel, account_id, inbound_message_id,
         bubble_index, client_id, delivered_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (delivery_id) DO NOTHING`,
      [
        delivery.id, delivery.userId, delivery.channel, delivery.accountId,
        delivery.inboundMessageId, delivery.bubbleIndex, delivery.clientId, delivery.deliveredAt,
      ],
    );
  }

  async deleteAllByUser(userId: string): Promise<void> {
    await this.pool.query('DELETE FROM outbound_deliveries WHERE user_id = $1', [userId]);
  }
}
