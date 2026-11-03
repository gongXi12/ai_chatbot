import type { OutboundDelivery } from './OutboundDeliveryRepository.js';
import type { OutboundDeliveryRepository } from './OutboundDeliveryRepository.js';

export class InMemoryOutboundDeliveryRepository implements OutboundDeliveryRepository {
  private readonly deliveries = new Map<string, OutboundDelivery>();

  async isDelivered(deliveryId: string): Promise<boolean> {
    return this.deliveries.has(deliveryId);
  }

  async markDelivered(delivery: OutboundDelivery): Promise<void> {
    this.deliveries.set(delivery.id, structuredClone(delivery));
  }

  async deleteAllByUser(userId: string): Promise<void> {
    for (const [id, delivery] of this.deliveries) {
      if (delivery.userId === userId) this.deliveries.delete(id);
    }
  }
}
