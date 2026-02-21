import crypto from "crypto";
export class UtilsHelper {
  constructor() {}
  static parsePhone(phone: string, pre: string) {
    if (!phone) return phone;
    let newPhone = "" + phone;
    newPhone = newPhone
      .replace(/^\+84/i, pre)
      .replace(/^\+0/i, pre)
      .replace(/^0/i, pre)
      .replace(/^84/i, pre);
    return newPhone;
  }
  static async buildHttpQuery(data: any) {
    let httpQuery = new URLSearchParams();

    const ordered = Object.keys(data)
      .sort()
      .reduce((obj: any, key: any) => {
        obj[key] = data[key];
        return obj;
      }, {});

    Object.keys(ordered).forEach(function (parameterName) {
      httpQuery.append(parameterName, ordered[parameterName]);
    });
    return httpQuery.toString();
  }

  static async buildSignature(data: any, secret: any) {
    let token = crypto
      .createHmac("sha256", secret)
      .update(data)
      .digest()
      .toString("base64");
    return token;
  }
}
