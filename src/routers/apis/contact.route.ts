import { ErrorHelper } from "../../base/error";
import { BaseRoute, Request, Response, NextFunction } from "../../base/baseRoute";
import { ContactModel } from "../../models/contact/contact.model";

class ContactRoute extends BaseRoute {
  constructor() {
    super();
  }

  customRouting() {
    this.router.post("/sendContact", this.route(this.sendContact));
    this.router.get("/getAllContacts", this.route(this.getAllContacts));
    this.router.delete("/deleteContact/:id", this.route(this.deleteContact));
  }

  async sendContact(req: Request, res: Response, next: NextFunction) {
    const { name, email, phone, message } = req.body;

    // Validation
    if (!name || !email || !message) {
      throw ErrorHelper.requestDataInvalid("Tên, email và nội dung không được bỏ trống");
    }

    // Create contact
    const contact = new ContactModel({
      name: String(name).trim(),
      email: String(email).trim(),
      phone: phone ? String(phone).trim() : "",
      message: String(message).trim(),
    });

    const savedContact = await contact.save();

    return res.status(201).json({
      status: 201,
      code: "201",
      message: "Gửi liên hệ thành công. Chúng tôi sẽ liên hệ với bạn sớm.",
      data: savedContact,
    });
  }

  async getAllContacts(req: Request, res: Response, next: NextFunction) {
    const contacts = await ContactModel.find({ isDeleted: false })
      .sort({ createdAt: -1 })
      .limit(100);

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        contacts,
        total: contacts.length,
      },
    });
  }

  async deleteContact(req: Request, res: Response, next: NextFunction) {
    const { id } = req.params;

    const contact = await ContactModel.findByIdAndUpdate(
      id,
      { isDeleted: true },
      { new: true }
    );

    if (!contact) {
      throw ErrorHelper.forbidden("Không tìm thấy liên hệ");
    }

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "Xóa liên hệ thành công",
      data: contact,
    });
  }
}

export default new ContactRoute().router;
