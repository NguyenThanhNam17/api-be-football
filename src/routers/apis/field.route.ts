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
import { FieldModel } from "../../models/field/field.model";

class FieldRoute extends BaseRoute {
  constructor() {
    super();
  }

  customRouting() {
    this.router.post(
      "/createField",
      [this.authentication],
      this.route(this.createField),
    );
    this.router.get("/getField/:id", this.route(this.getField));
    this.router.post(
      "/deleteField/:id",
      [this.authentication],
      this.route(this.deleteField),
    );
    this.router.get(
      "/getFieldDetail/:id",
      [this.authentication],
      this.route(this.getFieldDetail),
    );
    this.router.post(
      "/updateField/:id",
      [this.authentication],
      this.route(this.updateField),
    );
  }

  async authentication(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.get("x-token")) {
        throw ErrorHelper.unauthorized();
      }
      const tokenData: any = TokenHelper.decodeToken(req.get("x-token"));
      if ([ROLES.ADMIN, ROLES.USER, ROLES.OWNER].includes(tokenData.role_)) {
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

  async createField(req: Request, res: Response) {
    const {
      name,
      address,
      district,
      coverImage,
      article,
      images,
      managedByAdmin,
    } = req.body;

    if (!name || !address || !district) {
      throw ErrorHelper.requestDataInvalid("name, address, district required");
    }

    const slug = name
      .toLowerCase()
      .replace(/đ/g, "d")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, "-");

    // kiểm tra slug trùng
    const existed = await FieldModel.findOne({ slug });

    if (existed) {
      throw ErrorHelper.requestDataInvalid("field already exists");
    }

    const field = new FieldModel({
      name,
      slug,
      address,
      district,
      rating: 0,
      coverImage,
      article,
      images,
      ownerUserId: req.tokenInfo._id,
      ownerFullName: req.tokenInfo.name,
      managedByAdmin: managedByAdmin || false,
      isDeleted: false,
    });

    await field.save();

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        field,
      },
    });
  }

  async getField(req: Request, res: Response) {
    const { id } = req.params;

    if (!id) {
      throw ErrorHelper.requestDataInvalid("Thiếu id sân");
    }

    const field = await FieldModel.findOne({
      _id: id,
      isDeleted: false,
    }).populate("ownerUserId", "name phone");

    if (!field) {
      throw ErrorHelper.forbidden("Không tìm thấy sân");
    }

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        field,
      },
    });
  }

  async deleteField(req: Request, res: Response) {
    if (
      req.tokenInfo.role_ !== ROLES.ADMIN &&
      req.tokenInfo.role_ !== ROLES.OWNER
    ) {
      throw ErrorHelper.forbidden("Bạn không có quyền xoá sân");
    }
    const { id } = req.params;
    if (!id) {
      throw ErrorHelper.requestDataInvalid("Thiếu id sân");
    }
    const field = await FieldModel.findOne({
      _id: id,
      isDeleted: false,
    });
    if (!field) {
      throw ErrorHelper.forbidden("Không tìm thấy sân");
    }
    field.isDeleted = true;
    await field.save();
    return res.status(200).json({
      status: 200,
      code: "200",
      message: "succes",
      data: {
        field,
      },
    });
  }

  async getFieldDetail(req: Request, res: Response) {
    const { id } = req.params;

    if (!id) {
      throw ErrorHelper.requestDataInvalid("Thiếu id sân");
    }

    const field = await FieldModel.findOne({
      _id: id,
      isDeleted: false,
    }).populate("ownerUserId", "name phone");

    if (!field) {
      throw ErrorHelper.forbidden("Không tìm thấy sân");
    }

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: field,
    });
  }

  async updateField(req: Request, res: Response) {
    if (
      req.tokenInfo.role_ !== ROLES.ADMIN &&
      req.tokenInfo.role_ !== ROLES.OWNER
    ) {
      throw ErrorHelper.forbidden("Bạn không có quyền cập nhật sân");
    }

    const { id } = req.params;

    if (!id) {
      throw ErrorHelper.requestDataInvalid("Thiếu id sân");
    }

    const field = await FieldModel.findOne({
      _id: id,
      isDeleted: false,
    });

    if (!field) {
      throw ErrorHelper.forbidden("Không tìm thấy sân");
    }

    if (
      req.tokenInfo.role_ === ROLES.OWNER &&
      field.ownerUserId.toString() !== req.tokenInfo.userId
    ) {
      throw ErrorHelper.forbidden("Bạn không sở hữu sân này");
    }

    const { name, address, district, coverImage, article, images } = req.body;

    if (name !== undefined) field.name = name;
    if (address !== undefined) field.address = address;
    if (district !== undefined) field.district = district;
    if (coverImage !== undefined) field.coverImage = coverImage;
    if (article !== undefined) field.article = article;
    if (images !== undefined) field.images = images;

    await field.save();

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "Cập nhật sân thành công",
      data: field,
    });
  }
}

export default new FieldRoute().router;
