import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

let tokenSercet: any = process.env.SECRET;

export interface IPayLoadToken{
    _id?: string;
    role_?: string;
    email?: string;
    phone?: string;
    [name:string]: any;
}

export class TokenHelper {

    constructor() { }

    static generateToken(payload: IPayLoadToken){
        return jwt.sign(payload,tokenSercet, {expiresIn: '7d'});
    }

    static decodeToken(token:string){
        return jwt.verify(token, tokenSercet);
    }

    static generateKey() {
    const length = 7;
    var result = "";
    var characters =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    var charactersLength = characters.length;
    for (var i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
  }

}
