import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

export interface IPayLoadToken{
    _id?: string;
    role_?: string;
    email?: string;
    phone?: string;
    [name:string]: any;
}

export class TokenHelper {

    constructor() { }

    static getTokenSecret(){
        const tokenSecret = String(
          process.env.SECRET
          || process.env.JWT_SECRET
          || process.env.TOKEN_SECRET
          || ""
        ).trim();

        if (!tokenSecret) {
            throw new Error("JWT secret is not configured. Set SECRET, JWT_SECRET, or TOKEN_SECRET.");
        }

        return tokenSecret;
    }

    static generateToken(payload: IPayLoadToken){
        return jwt.sign(payload, TokenHelper.getTokenSecret(), {expiresIn: '7d'});
    }

    static decodeToken(token:string){
        return jwt.verify(token, TokenHelper.getTokenSecret());
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
