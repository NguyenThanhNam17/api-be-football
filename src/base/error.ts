export interface IErrorInfo {
  status: number;
  code: string;
  message: string;
  data?: any;
}

export class BaseError extends Error {
  constructor(status: number, code: string, message: string, data?: any) {
    super(message);
    this.info = { status, code, message, data };
  }
  info: IErrorInfo;
}

export class ErrorHelper extends BaseError {
  static unauthorized(){
    return new BaseError(401,'401', 'vui lòng đăng nhập');
  }

  static permissionDeny() {
    return new BaseError(405, "-2", "Không đủ quyền để truy cập");
  }

  static requestDataInvalid(message: string) {
    return new BaseError(403, "-3", "Dữ liệu gửi lên không hợp lệ", message);
  }
  static recoredNotFound(message: string) {
    return new BaseError(
      404,
      "-10",
      `Không tìm thấy dữ liệu yêu cầu: ${message}`
    );
  }
  static userWasOut() {
    return new BaseError(401, "-4", "Phiên đăng nhập của bạn đã hết hạn");
  }
  static userWasBlock() {
    return new BaseError(
      401,
      "-5",
      "Tài khoản của bạn đã bị Khóa vui lòng liên hệ Admin"
    );
  }
  static userNotExist() {
    return new BaseError(403, "-6", "Người dùng không tồn tại");
  }
  static userExisted() {
    return new BaseError(403, "-7", "Người dùng đã tồn tại");
  }
  static userPasswordNotCorrect() {
    return new BaseError(403, "-8", `Mật khẩu không đúng.`);
  }
  static forbidden(message: string) {
    return new BaseError(403, "-9", message);
  }
  // Unknow
  static somethingWentWrong(message?: string) {
    return new BaseError(500, "-10", message || "Có lỗi xảy ra");
  }
  static badToken() {
    return new BaseError(401, "-1", "Do not have access");
  }
}
