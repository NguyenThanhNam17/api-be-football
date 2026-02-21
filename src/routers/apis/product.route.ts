import { ErrorHelper } from "../../base/error";
import {
  BaseRoute,
  Request,
  Response,
  NextFunction,
} from "../../base/baseRoute";
import { UserModel } from "../../models/user/user.model";
import { TokenHelper } from "../../helper/token.helper";
import { ROLES } from "../../constants/role.const";
import { ProductModel } from "../../models/product/product.model";

class ProductRoute extends BaseRoute {
  constructor() {
    super();
  }

  customRouting() {
    this.router.get(
      "/getAllProduct",
      [this.authentication],
      this.route(this.getAllProduct),
    );
    this.router.get(
      "/getOneProduct",
      [this.authentication],
      this.route(this.getOneProduct),
    );
    this.router.post(
      "/createProduct",
      [this.authentication],
      this.route(this.createProduct),
    );
    this.router.post(
      "/deleteProduct",
      [this.authentication],
      this.route(this.deleteProduct),
    );
    this.router.post(
      "/updateProduct",
      [this.authentication],
      this.route(this.updateProduct),
    );
  }

  async authentication(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.get("x-token")) {
        throw ErrorHelper.unauthorized();
      }
      const tokenData: any = TokenHelper.decodeToken(req.get("x-token"));
      if ([ROLES.ADMIN, ROLES.CLIENT].includes(tokenData.role_)) {
        const user = await UserModel.findById(tokenData._id);
        if (!user) {
          throw ErrorHelper.unauthorized();
        }
        req.tokenInfo = tokenData;
        next();
      } else {
        throw ErrorHelper.permissionDeny();
      }
    } catch (err) {
      throw ErrorHelper.unauthorized();
    }
  }

  async getAllProduct(req: Request, res: Response) {
    let products = await ProductModel.find();
    if (!products) {
      throw ErrorHelper.recoredNotFound("Sản phẩm không tồn tại");
    }
    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        products,
      },
    });
  }

  async getOneProduct(req: Request, res: Response) {
    const { id } = req.body;
    const product = await ProductModel.findById(id);
    if (!product) {
      throw ErrorHelper.recoredNotFound("Sản phẩm không tồn tại");
    }
    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        product,
      },
    });
  }

  async createProduct(req: Request, res: Response) {
    if (req.tokenInfo.role_ !== ROLES.ADMIN) {
      throw ErrorHelper.permissionDeny();
    }
    const { name, price, description, category, image } = req.body;
    if (!name || !price) {
      throw ErrorHelper.requestDataInvalid("Thiếu tên hoặc giá sản phẩm");
    }
    let product = new ProductModel({
      name: name,
      price: price,
      description: description,
      category: category,
      image: image,
    });
    await product.save();
    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        product,
      },
    });
  }

  async deleteProduct(req: Request, res: Response) {
    if (req.tokenInfo.role_ !== ROLES.ADMIN) {
      throw ErrorHelper.permissionDeny();
    }
    const { id } = req.body;
    const product = await ProductModel.findById(id);
    if (!product) {
      throw ErrorHelper.recoredNotFound("Sản phẩm không tồn tại");
    }
    await product.deleteOne(product._id);
    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        product,
      },
    });
  }

  async updateProduct(req: Request, res: Response) {
    if (req.tokenInfo.role_ !== ROLES.ADMIN) {
      throw ErrorHelper.permissionDeny();
    }
    const { id, name, price, description, category, image } = req.body;
    if (!id) {
      throw ErrorHelper.requestDataInvalid("Thiếu id sản phẩm");
    }
    const product = await ProductModel.findById(id);
    if (!product) {
      throw ErrorHelper.recoredNotFound("Sản phẩm không tồn tại");
    }
    product.name = name || product.name;
    product.price = price || product.price;
    product.description = description || product.description;
    product.category = category || product.category;
    product.image = image || product.image;
    await product.save();
    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        product,
      },
    });
  }
}

export default new ProductRoute().router;
