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
import { FieldStatusEnum, TypeFieldEnum } from "../../constants/model.const";

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
      "/lockField/:fieldId",
      [this.authentication],
      this.route(this.lockField),
    );

    this.router.post(
      "/unlockField/:fieldId",
      [this.authentication],
      this.route(this.unlockField),
    );
    this.router.post(
      "/updateField/:id",
      [this.authentication],
      this.route(this.updateField),
    );
    this.router.post(
      "/approveField/:fieldId",
      [this.authentication],
      this.route(this.approveField),
    );

    this.router.post(
      "/rejectField/:fieldId",
      [this.authentication],
      this.route(this.rejectField),
    );
    this.router.get(
      "/getAllField",
      [this.authenticationOptional],
      this.route(this.getAllField),
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

  async authenticationOptional(
    req: Request,
    _res: Response,
    next: NextFunction,
  ) {
    try {
      const rawToken = String(req.get("x-token") || "").trim();

      if (!rawToken) {
        next();
        return;
      }

      const tokenData: any = TokenHelper.decodeToken(rawToken);
      if (![ROLES.ADMIN, ROLES.USER, ROLES.OWNER].includes(tokenData.role_)) {
        next();
        return;
      }

      const user = await UserModel.findById(tokenData._id);
      if (!user) {
        next();
        return;
      }

      req.tokenInfo = tokenData;
      next();
    } catch (_err) {
      next();
    }
  }

  async getAllField(req: Request, res: Response) {
    const role = req.tokenInfo?.role_;
    const userId = req.tokenInfo?._id;

    let query: any = {
      isDeleted: false,
    };

    if (role === ROLES.ADMIN) {
    } else if (role === ROLES.OWNER && userId) {
      query.ownerUserId = userId;
    } else {
      query.status = FieldStatusEnum.APPROVED;
    }

    const fields = await FieldModel.find(query).populate(
      "ownerUserId",
      "name phone",
    );

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        fields,
      },
    });
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
      type,
      openHours,
      pricePerHour,
    } = req.body;

    if (!name || !address || !district) {
      throw ErrorHelper.requestDataInvalid("name, address, district required");
    }

    if (type && !Object.values(TypeFieldEnum).includes(type)) {
      throw ErrorHelper.requestDataInvalid("Loại sân không hợp lệ");
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
      type,
      openHours,
      pricePerHour,
      ownerUserId: req.tokenInfo._id,
      ownerFullName: req.tokenInfo.name,
      managedByAdmin: managedByAdmin || false,
      status: FieldStatusEnum.PENDING,
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
      status: FieldStatusEnum.APPROVED,
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
      field.ownerUserId.toString() !== req.tokenInfo._id
    ) {
      throw ErrorHelper.forbidden("Bạn không sở hữu sân này");
    }
    const {
      name,
      address,
      district,
      coverImage,
      article,
      images,
      type,
      openHours,
      pricePerHour,
    } = req.body;

    if (name !== undefined) field.name = name;
    if (address !== undefined) field.address = address;
    if (district !== undefined) field.district = district;
    if (coverImage !== undefined) field.coverImage = coverImage;
    if (article !== undefined) field.article = article;
    if (images !== undefined) field.images = images;
    if (openHours !== undefined) field.openHours = openHours;
    if (pricePerHour !== undefined) field.pricePerHour = pricePerHour;
    if (type !== undefined) {
      if (!Object.values(TypeFieldEnum).includes(type)) {
        throw ErrorHelper.requestDataInvalid("Loại sân không hợp lệ");
      }
      field.type = type;
    }

    await field.save();

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: field,
    });
  }
  async approveField(req: Request, res: Response) {
    if (req.tokenInfo.role_ !== ROLES.ADMIN) {
      throw ErrorHelper.permissionDeny();
    }

    const { fieldId } = req.params;

    const field = await FieldModel.findById(fieldId);

    if (!field) {
      throw ErrorHelper.requestDataInvalid("Sân không tồn tại");
    }

    field.status = FieldStatusEnum.APPROVED;
    field.rejectReason = undefined;

    await field.save();

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: { field },
    });
  }
  async rejectField(req: Request, res: Response) {
    if (req.tokenInfo.role_ !== ROLES.ADMIN) {
      throw ErrorHelper.permissionDeny();
    }

    const { fieldId } = req.params;
    const { reason } = req.body;

    const field = await FieldModel.findById(fieldId);

    if (!field) {
      throw ErrorHelper.requestDataInvalid("Sân không tồn tại");
    }

    field.status = FieldStatusEnum.REJECTED;
    field.rejectReason = reason || "Không hợp lệ";

    await field.save();

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: { field },
    });
  }
  async lockField(req: Request, res: Response) {
    if (req.tokenInfo.role_ !== ROLES.ADMIN) {
      throw ErrorHelper.permissionDeny();
    }

    const { fieldId } = req.params;

    const field = await FieldModel.findById(fieldId);

    if (!field) {
      throw ErrorHelper.requestDataInvalid("Sân không tồn tại");
    }

    if (field.status !== FieldStatusEnum.APPROVED) {
      throw ErrorHelper.requestDataInvalid("Chỉ được khóa sân đã duyệt");
    }

    field.status = FieldStatusEnum.LOCKED;

    await field.save();

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: { field },
    });
  }

  async unlockField(req: Request, res: Response) {
    if (req.tokenInfo.role_ !== ROLES.ADMIN) {
      throw ErrorHelper.permissionDeny();
    }

    const { fieldId } = req.params;

    const field = await FieldModel.findById(fieldId);

    if (!field) {
      throw ErrorHelper.requestDataInvalid("Sân không tồn tại");
    }

    if (field.status !== FieldStatusEnum.LOCKED) {
      throw ErrorHelper.requestDataInvalid("Sân chưa bị khóa");
    }

    field.status = FieldStatusEnum.APPROVED;

    await field.save();

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: { field },
    });
  }
}

export default new FieldRoute().router;
