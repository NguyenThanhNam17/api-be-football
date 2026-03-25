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
import { TypeFieldEnum } from "../../constants/model.const";
import { FieldModel } from "../../models/field/field.model";
import { SubFieldModel } from "../../models/subField/subField.model";

class SubFieldRoute extends BaseRoute {
  constructor() {
    super();
  }

  customRouting() {
    this.router.post(
      "/createSubField",
      [this.authentication],
      this.route(this.createSubField),
    );
    this.router.get("/getSubField/:id", this.route(this.getSubField));
    this.router.post(
      "/deleteSubField/:id",
      [this.authentication],
      this.route(this.deleteSubField),
    );
    this.router.get(
      "/getSubFieldDetail/:id",
      [this.authentication],
      this.route(this.getSubFieldDetail),
    );
    this.router.post(
      "/updateSubField/:id",
      [this.authentication],
      this.route(this.updateSubField),
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

  async createSubField(req: Request, res: Response) {
    let { fieldId, key, name, type, pricePerHour } = req.body;
    if (!fieldId || !key || !name || !type || pricePerHour === undefined) {
      throw ErrorHelper.requestDataInvalid("Missing required fields");
    }

    if (!Object.values(TypeFieldEnum).includes(type)) {
      throw ErrorHelper.requestDataInvalid("Loại sân không hợp lệ");
    }

    if (pricePerHour < 0) {
      throw ErrorHelper.requestDataInvalid("Giá phải lớn hơn hoặc bằng 0");
    }

    const field = await FieldModel.findOne({ _id: fieldId, isDeleted: false });
    if (!field) {
      throw ErrorHelper.requestDataInvalid("Sân không tồn tại");
    }

    if (
      req.tokenInfo.role_ === ROLES.OWNER &&
      field.ownerUserId.toString() !== req.tokenInfo._id
    ) {
      throw ErrorHelper.permissionDeny();
    }

    const existed = await SubFieldModel.findOne({
      fieldId,
      key,
      isDeleted: false,
    });

    if (existed) {
      throw ErrorHelper.requestDataInvalid("Sân con đã tồn tại (trùng key)");
    }

    const subField = new SubFieldModel({
      fieldId,
      key,
      name,
      type,
      pricePerHour,
      isDeleted: false,
    });

    await subField.save();

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        subField,
      },
    });
  }

  async getSubField(req: Request, res: Response) {
    const { id } = req.params;

    if (!id) {
      throw ErrorHelper.requestDataInvalid("Thiếu id sân con");
    }

    const subField = await SubFieldModel.findOne({
      _id: id,
      isDeleted: false,
    }).populate("fieldId", "name address");

    if (!subField) {
      throw ErrorHelper.requestDataInvalid("Sân con không tồn tại");
    }

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        subField,
      },
    });
  }

  async deleteSubField(req: Request, res: Response) {
    const { id } = req.params;
    if (!id) {
      throw ErrorHelper.requestDataInvalid("Thiếu id sân con");
    }

    let subField = await SubFieldModel.findOne({
      _id: id,
      isDeleted: false,
    });
    if (!subField) {
      throw ErrorHelper.requestDataInvalid("Sân con không tồn tại");
    }

    let field = await FieldModel.findOne({
      _id: subField.fieldId,
      isDeleted: false,
    });

    if (!field) {
      throw ErrorHelper.requestDataInvalid("Sân không tồn tại");
    }

    if (
      (req.tokenInfo.role_ === ROLES.OWNER &&
        field.ownerUserId.toString() === req.tokenInfo._id) ||
      req.tokenInfo.role_ === ROLES.ADMIN
    ) {
      subField.isDeleted = true;
    } else {
      throw ErrorHelper.permissionDeny();
    }

    // const booking = await BookingModel.findOne({
    //   subFieldId: id,
    //   isDeleted: false,
    // });

    // if (booking) {
    //   throw ErrorHelper.requestDataInvalid("Sân đã có lịch đặt, không thể xoá");
    // }

    await subField.save();
    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        subField,
      },
    });
  }

  async getSubFieldDetail(req: Request, res: Response) {
    const { id } = req.params;

    if (!id) {
      throw ErrorHelper.requestDataInvalid("Id sân con không hợp lệ");
    }

    const subField = await SubFieldModel.findOne({
      _id: id,
      isDeleted: false,
    }).populate("fieldId", "name ownerFullName address district rating");

    if (!subField) {
      throw ErrorHelper.requestDataInvalid("Sân con không tồn tại");
    }

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        subField,
      },
    });
  }

  async updateSubField(req: Request, res: Response) {
    const { id } = req.params;
    let { key, name, type, pricePerHour } = req.body;

    if (!id) {
      throw ErrorHelper.requestDataInvalid("Id sân con không hợp lệ");
    }

    const subField = await SubFieldModel.findOne({
      _id: id,
      isDeleted: false,
    });
    if (!subField) {
      throw ErrorHelper.requestDataInvalid("Sân con không tồn tại");
    }

    let field = await FieldModel.findOne({
      _id: subField.fieldId,
      isDeleted: false,
    });

    if (!field) {
      throw ErrorHelper.requestDataInvalid("Sân không tồn tại");
    }

    if (
      !(
        req.tokenInfo.role_ === ROLES.OWNER &&
        field.ownerUserId.toString() === req.tokenInfo._id
      ) ||
      req.tokenInfo.role_ !== ROLES.ADMIN
    ) {
      throw ErrorHelper.permissionDeny();
    }

    if (type && !Object.values(TypeFieldEnum).includes(type)) {
      throw ErrorHelper.requestDataInvalid("Loại sân không hợp lệ");
    }

    if (key && key !== subField.key) {
      const existed = await SubFieldModel.findOne({
        fieldId: subField.fieldId,
        key,
        isDeleted: false,
      });

      if (existed) {
        throw ErrorHelper.requestDataInvalid("Key sân con đã tồn tại");
      }

      subField.key = key;
    }

    if (name !== undefined) subField.name = name;
    if (type !== undefined) subField.type = type;
    if (pricePerHour !== undefined) {
      if (pricePerHour < 0) {
        throw ErrorHelper.requestDataInvalid("Giá không hợp lệ");
      }
      subField.pricePerHour = pricePerHour;
    }

    await subField.save();

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        subField,
      },
    });
  }
}

export default new SubFieldRoute().router;
