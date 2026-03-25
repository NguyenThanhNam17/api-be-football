export enum UserRoleEnum {
  ADMIN = "ADMIN",
  USER = "USER",
  OWNER = "OWNER",
}

export enum TypeFieldEnum {
  _5_nguoi = "5-nguoi",
  _7_nguoi = "7-nguoi",
  _11_nguoi = "11-nguoi",
}

export enum BookingStatusEnum {
  PENDING = "PENDING",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
  CONFIRMED = "CONFIRMED"
}

export enum DepositStatusEnum {
  UNPAID = "UNPAID",
  PAID = "PAID",
}

export enum DepositMethodEnum {
  CASH = "cash",                
  BANK_TRANSFER = "bank_transfer", 
  MOMO = "momo",           
  VNPAY = "vnpay",        
}

export enum PaymentStatusEnum {
  PENDING = "PENDING",
  PAID = "PAID",
  FAILED = "FAILED",
}

export enum PaymentMethodEnum {
  CASH = "CASH",
  MOMO = "MOMO",
  BANK = "BANK",
}