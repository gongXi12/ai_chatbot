export interface OutboundDelivery {
  id: string;
  userId: string;
  channel: string;
  accountId: string;
  inboundMessageId: string;
  bubbleIndex: number;
  clientId: string;
  deliveredAt: Date;
}

export interface OutboundDeliveryRepository {
  isDelivered(deliveryId: string): Promise<boolean>;
  markDelivered(delivery: OutboundDelivery): Promise<void>;
  deleteAllByUser(userId: string): Promise<void>;
}
