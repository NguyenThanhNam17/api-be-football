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
import {
  BookingStatusEnum,
  FieldStatusEnum,
  TypeFieldEnum,
} from "../../constants/model.const";
import { FieldModel } from "../../models/field/field.model";
import { SubFieldModel } from "../../models/subField/subField.model";
import {
  ensureTimeSlotsForOpenHoursList,
  parseOpenHoursRange,
} from "../../helper/timeSlot.helper";
import { BookingModel } from "../../models/booking/booking.model";

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
      "/deleteSubField",
      [this.authentication],
      this.route(this.deleteSubField),
    );
    this.router.get(
      "/getByField/:fieldId",
      this.route(this.getSubFieldByField),
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

  async getSubFieldByField(req: Request, res: Response) {
    const { fieldId } = req.params;

    if (!fieldId) {
      throw ErrorHelper.requestDataInvalid("Thiếu fieldId");
    }

    const field = await FieldModel.findOne({
      _id: fieldId,
    });

    if (!field) {
      throw ErrorHelper.requestDataInvalid("Sân không tồn tại");
    }

    const subFields = await SubFieldModel.find({
      fieldId: fieldId,
    });

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        subFields,
      },
    });
  }

  async createSubField(req: Request, res: Response) {
    let { fieldId, key, name, type, pricePerHour, openHours } = req.body;

    // 1. Validate input cơ bản
    if (!fieldId || !key || !name || !type || pricePerHour === undefined) {
      throw ErrorHelper.requestDataInvalid("Missing required fields");
    }

    if (pricePerHour < 0) {
      throw ErrorHelper.requestDataInvalid("Giá phải >= 0");
    }

    // 2. Validate type sân
    if (!Object.values(TypeFieldEnum).includes(type)) {
      throw ErrorHelper.requestDataInvalid("Loại sân không hợp lệ");
    }

    // 3. Validate openHours (optional)
    if (openHours && typeof openHours !== "string") {
      throw ErrorHelper.requestDataInvalid("openHours phải là string");
    }

    if (openHours && !parseOpenHoursRange(openHours)) {
      throw ErrorHelper.requestDataInvalid(
        "Giờ mở cửa phải đúng định dạng HH:mm-HH:mm",
      );
    }

    // 4. Check field tồn tại
    let field = await FieldModel.findById(fieldId);
    if (!field) {
      throw ErrorHelper.requestDataInvalid("Sân không tồn tại");
    }

    if (field.status !== FieldStatusEnum.APPROVED && field.status !== FieldStatusEnum.PENDING){
      throw ErrorHelper.forbidden("Sân chưa được duyệt");
    }

      if (req.tokenInfo.role_ === ROLES.OWNER) {
        // 6. Check quyền OWNER
        if (field.ownerUserId.toString() !== req.tokenInfo._id) {
          throw ErrorHelper.permissionDeny();
        }
      }

    // 7. Check trùng key trong cùng field
    const existed = await SubFieldModel.findOne({
      fieldId,
      key,
    });

    if (existed) {
      throw ErrorHelper.requestDataInvalid("Key sân con đã tồn tại");
    }

    // 8. Tạo subField
    const subField = new SubFieldModel({
      fieldId,
      key,
      name,
      type,
      pricePerHour,
      openHours: openHours || field.openHours, // fallback
    });

    await subField.save();

    // 9. Tạo timeSlot an toàn (fix bug undefined)
    await ensureTimeSlotsForOpenHoursList(
      [openHours, field.openHours].filter(Boolean),
    );

    // 10. Response
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
    const { id } = req.body;

    if (!id) {
      throw ErrorHelper.requestDataInvalid("Thiếu id sân con");
    }

    const subField = await SubFieldModel.findById(id);
    if (!subField) {
      throw ErrorHelper.requestDataInvalid("Sân con không tồn tại");
    }

    const field = await FieldModel.findById(subField.fieldId);

    // nếu field đã bị xoá → xoá luôn subField
    if (!field) {
      await SubFieldModel.deleteOne({ _id: id });

      return res.status(200).json({
        status: 200,
        code: "200",
        message: "Sân cha không tồn tại, đã xoá sân con",
      });
    }

    // check quyền
    const isOwner =
      req.tokenInfo.role_ === ROLES.OWNER &&
      field.ownerUserId.toString() === req.tokenInfo._id;

    const isAdmin = req.tokenInfo.role_ === ROLES.ADMIN;

    if (!isOwner && !isAdmin) {
      throw ErrorHelper.permissionDeny();
    }

    // check booking
    const hasBooking = await BookingModel.findOne({
      subFieldId: id,
      status: { $ne: BookingStatusEnum.COMPLETED },
    });

    if (hasBooking) {
      throw ErrorHelper.requestDataInvalid(
        "Sân đang có booking chưa hoàn thành",
      );
    }

    // xoá booking liên quan
    await BookingModel.deleteMany({ subFieldId: id });

    // xoá subField
    await SubFieldModel.deleteOne({ _id: id });

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "Xoá sân con thành công",
    });
  }

  async getSubFieldDetail(req: Request, res: Response) {
    const { id } = req.params;

    if (!id) {
      throw ErrorHelper.requestDataInvalid("Id sân con không hợp lệ");
    }

    const subField = await SubFieldModel.findOne({
      _id: id,
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
    let { key, name, type, pricePerHour, openHours } = req.body;

    if (!id) {
      throw ErrorHelper.requestDataInvalid("Id sân con không hợp lệ");
    }

    const subField = await SubFieldModel.findOne({
      _id: id,

    });
    if (!subField) {
      throw ErrorHelper.requestDataInvalid("Sân con không tồn tại");
    }

    let field = await FieldModel.findOne({
      _id: subField.fieldId,
    });

    if (!field) {
      throw ErrorHelper.requestDataInvalid("Sân không tồn tại");
    }

    if (
      req.tokenInfo.role_ !== ROLES.ADMIN &&
      !(
        req.tokenInfo.role_ === ROLES.OWNER &&
        field.ownerUserId.toString() === req.tokenInfo._id
      )
    ) {
      throw ErrorHelper.permissionDeny();
    }

    if (type && !Object.values(TypeFieldEnum).includes(type)) {
      throw ErrorHelper.requestDataInvalid("Loại sân không hợp lệ");
    }

    if (openHours && !parseOpenHoursRange(openHours)) {
      throw ErrorHelper.requestDataInvalid(
        "Giờ mở cửa phải đúng định dạng HH:mm-HH:mm",
      );
    }

    if (key && key !== subField.key) {
      const existed = await SubFieldModel.findOne({
        fieldId: subField.fieldId,
        key,
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
    if (openHours !== undefined) subField.openHours = openHours;

    await subField.save();
    await ensureTimeSlotsForOpenHoursList([
      subField.openHours,
      field.openHours,
    ]);

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
