import { BaseService } from "../base/baseService";
import moment from "moment-timezone";
import { Document, Model } from "mongoose";
import _ from "lodash";
import { ErrorHelper } from "./error";

export interface IQueryOptions {}

export abstract class CrudService<
  M extends Model<Document, {}>
> extends BaseService {
  model: M;

  constructor(model: M) {
    super();
    this.model = model;
  }

  async fetch(queryInput: any, populates?: any) {
    queryInput = { ...queryInput };
    var limit = queryInput.limit || 10;
    const skip = queryInput.offset || (queryInput.page - 1) * limit || 0;
    const order = queryInput.order;
    const search = queryInput.search;
    const timestamp = queryInput.timestamp;
    const timeSort = queryInput.timeSort || -1;
    const query = this.model.find();

    if (limit > 40) {
      limit = 40;
    }
    // timestamp
    const q: any[] = [];
    if (timestamp) {
      // Set index
      const time = moment(timestamp).subtract(7, "hours").toDate();
      if (timeSort == -1) {
        // Bài viết cũ hơn
        q.push({ $lte: time });
      } else if (timeSort == 1) {
        //Bài viết mới hơn
        q.push({ $gte: time });
      }
    }
    if (search) {
      if (search.includes(" ")) {
        _.set(queryInput, "filter.$text.$search", search);
        query.select({ _score: { $meta: "textScore" } });
        query.sort({ _score: { $meta: "textScore" } });
      } else {
        const textSearchIndex = this.model.schema
          .indexes()
          .find((c: any) => _.values(c[0]!).some((d: any) => d == "text"));
        if (textSearchIndex) {
          const or: any[] = [];
          Object.keys(textSearchIndex[0]!).forEach((key) => {
            or.push({ [key]: { $regex: search, $options: "i" } });
          });
          if (_.get(queryInput, "filter.$or")) {
            let query = _.get(queryInput, "filter.$or");
            _.set(queryInput, "filter.$and", [{ $or: query }, { $or: or }]);
          } else {
            _.set(queryInput, "filter.$or", or);
          }
        }
      }
    }

    if (queryInput.filter) {
      const filter = JSON.parse(
        JSON.stringify(queryInput.filter).replace(
          /\"(\_\_)(\w+)\"\:/g,
          `"$$$2":`
        )
      );
      if (q[0]) {
        filter.updatedAt = q[0];
      }
      query.setQuery({ ...filter });
    } else {
      if (q[0]) {
        query.setQuery(q[0]);
      }
    }

    if (order) {
      query.sort(order);
    }
    let query4Count = { ...query?.getQuery() };
    delete query4Count.location;

    const countQuery: any = this.model.find();
    countQuery.setQuery(query4Count);

    query.limit(limit);
    query.skip(skip);

    if (populates && populates.length != 0) {
      for (let populate of populates) {
        query.populate(populate);
      }
    }
    return await Promise.all([query.exec(), countQuery.count()]).then((res) => {
      return {
        data: res[0],
        total: res[1],
        pagination: {
          page: queryInput.page || 1,
          limit: limit,
          offset: skip,
          total: res[1],
        },
      };
    });
  }
  async findOne(filter: any) {
    return await this.model.findOne(filter);
  }

  async create(data: any) {
    return await this.model.create(data);
  }

  async updateOne(id: string, data: any) {
    await this.model.updateOne({ _id: id }, data, {
      runValidators: true,
      context: "query",
    });
    let record = await this.model.findOne({ _id: id });
    if (!record) throw ErrorHelper.recoredNotFound("Không tìm thấy dữ liệu");
    return record;
  }
}
