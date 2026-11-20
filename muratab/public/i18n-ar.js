'use strict';
/* Arabic (العربية). Keys are the English UI text; anything missing falls back to English. */
Object.assign(I18N.ar, {
  // language toggle shows the *other* language
  'العربية': 'English',

  // navigation & shell
  'Home': 'الرئيسية', 'Orders': 'الطلبات', 'Stock': 'المخزون', 'Inventory': 'الجرد', 'Suppliers': 'الموردون',
  'Transfers & Ledger': 'التحويلات والسجل', 'Live prices': 'الأسعار المباشرة', 'Setup': 'الإعدادات', 'Acting as': 'الفرع الحالي',
  'Inventory & supply network': 'شبكة المخزون والتوريد', 'Connecting…': 'جارٍ الاتصال…', 'Offline': 'غير متصل', 'Feed error': 'خطأ في الأسعار',
  'Prices paused': 'الأسعار متوقفة', 'Could not load': 'تعذّر التحميل',

  // greetings & home
  ',': '،', 'Good morning': 'صباح الخير', 'Good afternoon': 'مساء الخير', 'Good evening': 'مساء الخير',
  'Theme': 'المظهر', 'System': 'تلقائي', 'Light': 'فاتح', 'Dark': 'داكن', 'Colour': 'اللون', 'Language': 'اللغة',
  'Teal': 'أخضر مزرق', 'Saffron': 'زعفراني', 'Indigo': 'نيلي', 'Rose': 'وردي', 'Olive': 'زيتوني',
  'Manager': 'المدير', 'General Manager': 'المدير العام', 'Edit profile': 'تعديل الملف', 'New order': 'طلب جديد',
  'Kitchen board': 'شاشة المطبخ', 'Stock dashboard': 'لوحة المخزون', 'orders today': 'طلبات اليوم', 'sales today': 'مبيعات اليوم',
  'in the kitchen': 'في المطبخ', 'items to restock': 'أصناف تحتاج تعبئة', '{n} locations': '{n} فروع',
  'Locations & tables': 'الفروع والطاولات', 'Tables': 'الطاولات', 'Seats': 'المقاعد', 'In use now': 'مشغولة الآن',
  '{n} to restock': '{n} تحتاج تعبئة', 'Stock healthy': 'المخزون جيد', 'Most popular': 'الأكثر طلباً',
  "Owner's favourites": 'اختيارات المالك', 'Mark favourites in the menu': 'حدّد الأطباق المفضلة في القائمة',
  'Best sellers · last 14 days': 'الأكثر مبيعاً · آخر ١٤ يوماً', 'No orders yet': 'لا توجد طلبات بعد', 'Menu': 'القائمة',
  'dishes': 'طبق', 'Average price': 'متوسط السعر', 'Open': 'فتح', 'ingredients tracked': 'مكوّن متابَع',
  'Worth {v} across all locations': 'بقيمة {v} في جميع الفروع', '{n} items need restocking': '{n} أصناف تحتاج تعبئة',
  'Nothing needs restocking': 'لا شيء يحتاج تعبئة', 'Edit stock': 'تعديل المخزون', 'Kitchenware & utilities': 'أدوات المطبخ والمرافق',
  'items across {n} types': 'قطعة من {n} أنواع', 'Below minimum': 'أقل من الحد الأدنى', 'Everything at or above minimum': 'كل شيء عند الحد الأدنى أو أعلى',
  'Ordering channels': 'قنوات الطلب', 'In the restaurant': 'داخل المطعم', '{n} locations linked': '{n} فروع مرتبطة', 'Not connected': 'غير مرتبط',
  '{n} today': '{n} اليوم', 'On': 'مفعّل', 'Off': 'متوقف', 'Edit': 'تعديل',

  // wizard
  'Welcome': 'مرحباً', 'Restaurant & manager': 'المطعم والمدير', 'Ingredients & stock': 'المكوّنات والمخزون', 'Menu & favourites': 'القائمة والمفضلة',
  'Review & finish': 'المراجعة والإنهاء', 'Welcome to Muratab': 'أهلاً بك في مرتب',
  'Muratab means “neat”. Tell us about your restaurant once – locations, tables, menu, stock and kitchenware – and every screen works from your real information.':
    'مرتب تعني «منظم». عرّفنا بمطعمك مرة واحدة – الفروع والطاولات والقائمة والمخزون وأدوات المطبخ – وستعمل كل الشاشات بمعلوماتك الحقيقية.',
  'Make it yours': 'اجعله على ذوقك', 'How would you like to start?': 'كيف تريد أن تبدأ؟', 'Set up my restaurant': 'إعداد مطعمي',
  'Start empty and enter your own locations, menu and stock.': 'ابدأ من الصفر وأدخل فروعك وقائمتك ومخزونك.',
  'Start from the sample restaurant': 'ابدأ من المطعم التجريبي',
  'A three-branch group with menu, stock and orders already filled in. Edit anything as you go.': 'مجموعة من ثلاثة فروع مع قائمة ومخزون وطلبات جاهزة. عدّل ما تشاء أثناء الإعداد.',
  'Main branch': 'الفرع الرئيسي', 'Restaurant or group name': 'اسم المطعم أو المجموعة', 'Cuisine / concept': 'نوع المطبخ / المفهوم',
  'e.g. Lebanese grill, casual dining': 'مثال: مشاوي لبنانية، مطعم عائلي', "Manager's name": 'اسم المدير', 'Job title': 'المسمى الوظيفي',
  'Phone': 'الهاتف', 'Email': 'البريد الإلكتروني', 'Currency code': 'رمز العملة', 'Add the restaurant name': 'أضف اسم المطعم',
  "Add the manager's name": 'أضف اسم المدير', 'New location': 'فرع جديد', 'Remove location': 'حذف الفرع', 'Location name': 'اسم الفرع',
  'Address / area': 'العنوان / المنطقة', 'Opening hours': 'ساعات العمل', '{n} tables, {s} seats': '{n} طاولة، {s} مقعد', 'Table': 'الطاولة',
  'Area': 'المنطقة', 'Add': 'أضف', 'How many tables': 'عدد الطاولات', 'tables with': 'طاولات بـ', 'Seats each': 'مقاعد لكل طاولة', 'seats in': 'مقاعد في',
  'Add tables': 'إضافة طاولات', '+ Add another location': '+ إضافة فرع آخر', 'Every location needs a name': 'كل فرع يحتاج إلى اسم',
  'Table name': 'اسم الطاولة', 'Remove': 'حذف', 'Indoor': 'داخلي', 'Terrace': 'تراس', 'Outdoor': 'خارجي', 'Bar': 'البار', 'Private room': 'غرفة خاصة', 'Concourse': 'الردهة',
  'List what you cook with and how much is on the shelf now at each location. Muratab subtracts what every order uses and warns you before you run out.':
    'أدرج المكوّنات التي تطبخ بها والكمية المتوفرة الآن في كل فرع. يخصم مرتب ما يستهلكه كل طلب وينبّهك قبل نفاد المخزون.',
  'Quick add:': 'إضافة سريعة:', 'Ingredient': 'المكوّن', 'Unit': 'الوحدة', 'Category': 'الفئة', 'Shelf life (days)': 'مدة الصلاحية (أيام)',
  'On hand': 'المتوفر', '+ Add ingredient': '+ إضافة مكوّن', 'Rice': 'أرز', 'Flour': 'طحين', 'Chicken': 'دجاج', 'Eggs': 'بيض', 'Milk': 'حليب',
  'Tomato': 'طماطم', 'Onion': 'بصل', 'Cooking oil': 'زيت طبخ', 'Bread': 'خبز',
  'Produce': 'خضار وفواكه', 'Meat': 'لحوم', 'Seafood': 'مأكولات بحرية', 'Dairy': 'ألبان', 'Bakery': 'مخبوزات', 'Dry Goods': 'مواد جافة', 'Spices': 'بهارات', 'Drinks': 'مشروبات',
  'Add each dish with its price and recipe. Tap the star on your most popular dishes – they appear on the home screen. Changes here save immediately.':
    'أضف كل طبق مع سعره ووصفته. اضغط النجمة على أكثر أطباقك طلباً لتظهر في الشاشة الرئيسية. تُحفظ التغييرات هنا فوراً.',
  'Add your ingredients first – recipes are built from them.': 'أضف المكوّنات أولاً – فالوصفات تُبنى منها.',
  'No dishes yet.': 'لا توجد أطباق بعد.', '+ Add dish': '+ إضافة طبق', 'Delete': 'حذف', 'Delete dish?': 'حذف الطبق؟',
  'Count your kitchenware, tableware and utilities at each location. Set a minimum and Muratab flags anything that falls below it.':
    'عُدّ أدوات المطبخ والمائدة والمرافق في كل فرع. حدّد حداً أدنى وسينبّهك مرتب إلى ما ينخفض عنه.',
  'Item': 'الصنف', 'Minimum': 'الحد الأدنى', '+ Add item': '+ إضافة صنف',
  'Cookware': 'أواني الطبخ', 'Appliances': 'الأجهزة', 'Utensils': 'أدوات المطبخ', 'Tableware': 'أدوات المائدة', 'Cleaning': 'التنظيف', 'Utilities': 'المرافق',
  'Oven': 'فرن', 'Deep fryer': 'قلاية عميقة', 'Refrigerator': 'ثلاجة', 'Chef knives': 'سكاكين الطهاة', 'Cutting boards': 'ألواح التقطيع', 'Frying pans': 'مقالي',
  'Saucepans': 'قدور صغيرة', 'Dinner plates': 'صحون التقديم', 'Glasses': 'أكواب', 'Cutlery sets': 'أطقم أدوات المائدة', 'Gas cylinders': 'أسطوانات الغاز',
  'Fire extinguishers': 'طفايات الحريق', 'First-aid kits': 'حقائب الإسعافات الأولية', 'Mops & buckets': 'ممسحات ودلاء',
  'Choose where orders come from. Delivery-app orders arrive in the same kitchen board as dine-in, and every status change is sent back to the app.':
    'اختر مصادر الطلبات. تصل طلبات تطبيقات التوصيل إلى شاشة المطبخ نفسها مع طلبات الصالة، وتُرسَل كل حالة جديدة إلى التطبيق.',
  'Store ID': 'رقم المتجر', 'from the platform': 'من المنصة', 'Accept orders automatically': 'قبول الطلبات تلقائياً',
  'Preparation time (minutes)': 'وقت التحضير (دقائق)', 'Order webhook for the platform': 'رابط استقبال الطلبات للمنصة',
  'Available when Muratab runs on your server. In this prototype, use “Simulate order” on the Orders screen.': 'متاح عند تشغيل مرتب على خادمك. في هذا النموذج استخدم «محاكاة طلب» في شاشة الطلبات.',
  'Orders taken at the table, linked to your floor plan.': 'طلبات تؤخذ على الطاولة ومرتبطة بمخطط الصالة.', 'Orders collected at the counter.': 'طلبات تُستلم من الكاونتر.',
  'no manager yet': 'لم يُحدد مدير بعد', '{n} locations, {t} tables': '{n} فروع، {t} طاولة', '{n} ingredients': '{n} مكوّن',
  '{n} dishes, {p} favourites': '{n} طبق، {p} مفضلة', '{n} types of item': '{n} أنواع من الأصناف',
  'You can change any of this later from the home screen.': 'يمكنك تغيير أي من هذا لاحقاً من الشاشة الرئيسية.',
  'Setup steps': 'خطوات الإعداد', 'Step {n} of {total}': 'الخطوة {n} من {total}', 'Back to home': 'العودة للرئيسية', 'Back': 'رجوع',
  'Finish setup': 'إنهاء الإعداد', 'Done': 'تم', 'Save & continue': 'حفظ ومتابعة', 'Save': 'حفظ', 'Saved': 'تم الحفظ',
  'All set – welcome to Muratab': 'كل شيء جاهز – أهلاً بك في مرتب',

  // dish form
  'Add a dish': 'إضافة طبق', 'Edit {name}': 'تعديل {name}', 'Dish name': 'اسم الطبق', 'Menu price': 'السعر في القائمة', 'e.g. Mains': 'مثال: أطباق رئيسية',
  'Short description': 'وصف قصير', 'One of our most popular dishes (shown on the home screen)': 'من أكثر أطباقنا طلباً (يظهر في الشاشة الرئيسية)',
  'Sold through': 'يُباع عبر', "Recipe – how much of each ingredient one portion uses (in the ingredient's unit)": 'الوصفة – كمية كل مكوّن في الحصة الواحدة (بوحدة المكوّن)',
  'Save dish': 'حفظ الطبق', 'Add dish': 'إضافة الطبق', 'Dish saved': 'تم حفظ الطبق', 'Dish added to the menu': 'أُضيف الطبق إلى القائمة',

  // orders
  'Dine-in': 'داخل المطعم', 'Takeaway': 'سفري', 'Talabat': 'طلبات', 'Deliveroo': 'ديليفرو', 'Careem Food': 'كريم فود', 'Website / app': 'الموقع / التطبيق',
  'Order history': 'سجل الطلبات', 'Delivery apps': 'تطبيقات التوصيل', 'New from apps': 'جديد من التطبيقات', 'Accepted': 'مقبول', 'Preparing': 'قيد التحضير', 'Ready': 'جاهز',
  'Accept': 'قبول', 'Reject': 'رفض', 'Start cooking': 'بدء التحضير', 'Cancel': 'إلغاء', 'Mark ready': 'جاهز للتسليم', 'Served / picked up': 'قُدّم / استُلم',
  '{n} min': '{n} د', 'portions you can still make': 'الحصص الممكن تحضيرها', 'Sold out': 'نفد', '{n} portions': '{n} حصة', 'Current order': 'الطلب الحالي',
  'No table (bar / counter)': 'بدون طاولة (بار / كاونتر)', '{n} seats': '{n} مقاعد', 'in use': 'مشغولة', 'Customer name': 'اسم العميل',
  'Remove one': 'إنقاص واحد', 'Add one': 'إضافة واحد', 'Tap a dish to add it.': 'اضغط على طبق لإضافته.', 'Kitchen note': 'ملاحظة للمطبخ',
  'e.g. no onions, allergy…': 'مثال: بدون بصل، حساسية…', 'Total': 'الإجمالي', 'Send to kitchen': 'إرسال إلى المطبخ', 'Clear': 'مسح',
  'No dishes yet – add them in Setup.': 'لا توجد أطباق بعد – أضفها من الإعدادات.',
  'Orders from every channel in one place. Accepting an order takes its ingredients out of stock; delivery apps are told about every change.':
    'طلبات كل القنوات في مكان واحد. قبول الطلب يخصم مكوّناته من المخزون، وتُبلَّغ تطبيقات التوصيل بكل تغيير.',
  'Nothing here': 'لا شيء هنا', '{free} of {n} tables free. Tap a free table to start an order for it.': '{free} من {n} طاولة متاحة. اضغط على طاولة متاحة لبدء طلب لها.',
  'Free': 'متاحة', 'No tables yet.': 'لا توجد طاولات بعد.', 'Time': 'الوقت', 'Channel': 'القناة', 'Table / customer': 'الطاولة / العميل', 'Items': 'الأصناف', 'Status': 'الحالة',
  'This prototype simulates the delivery apps: “Simulate order” creates a realistic platform order and sends it through the same webhook code a real platform would call. Status updates back to the app are recorded below instead of being sent.':
    'يحاكي هذا النموذج تطبيقات التوصيل: «محاكاة طلب» ينشئ طلباً واقعياً ويمرّره عبر نفس كود الاستقبال الذي تستدعيه المنصة الحقيقية. تُسجَّل تحديثات الحالة أدناه بدلاً من إرسالها.',
  'Platforms send orders to the webhook shown in Setup → Ordering channels. Status updates are sent for real when the platform’s API URL and token are set on the server (for example TALABAT_API_URL and TALABAT_API_TOKEN); otherwise they are recorded below as simulated.':
    'ترسل المنصات الطلبات إلى الرابط الظاهر في الإعدادات ← قنوات الطلب. تُرسَل تحديثات الحالة فعلياً عند ضبط رابط واجهة المنصة ورمزها على الخادم (مثل TALABAT_API_URL و TALABAT_API_TOKEN)، وإلا تُسجَّل أدناه كمحاكاة.',
  'No store ID for {b}': 'لا يوجد رقم متجر لفرع {b}', 'Accepts orders automatically': 'يقبل الطلبات تلقائياً', 'Orders wait for you to accept': 'الطلبات تنتظر قبولك',
  'Simulate order': 'محاكاة طلب', 'Send menu': 'إرسال القائمة', 'Settings': 'الإعدادات', 'Activity with delivery apps': 'النشاط مع تطبيقات التوصيل', 'latest first': 'الأحدث أولاً',
  'App': 'التطبيق', 'Event': 'الحدث', 'Details': 'التفاصيل', 'View data': 'عرض البيانات', 'No activity yet.': 'لا يوجد نشاط بعد.', 'Response': 'الرد', 'Close': 'إغلاق',
  'Received from the app': 'مستلم من التطبيق', 'Sent to the app': 'مرسل إلى التطبيق', 'Reject order': 'رفض الطلب', 'Cancel order': 'إلغاء الطلب',
  'Reason (sent to the delivery app)': 'السبب (يُرسل إلى تطبيق التوصيل)', 'ITEM_UNAVAILABLE': 'صنف غير متوفر', 'TOO_BUSY': 'المطبخ مزدحم', 'CLOSED': 'المطعم مغلق',
  'ADDRESS_INCOMPLETE': 'العنوان غير مكتمل', 'OTHER': 'سبب آخر', 'Order updated': 'تم تحديث الطلب', 'Order #{n} sent to the kitchen': 'أُرسل الطلب رقم {n} إلى المطبخ',
  '{app} order #{n} received – {status}': 'وصل طلب {app} رقم {n} – {status}', 'Menu sent': 'تم إرسال القائمة',
  'order received': 'استلام طلب', 'order accepted': 'قبول طلب', 'order rejected': 'رفض طلب', 'order ready': 'طلب جاهز', 'order preparing': 'تحضير طلب',
  'order picked_up': 'استلام المندوب', 'order cancelled': 'إلغاء طلب', 'menu sync': 'مزامنة القائمة', 'availability': 'التوفر',

  // statuses
  'Out of stock': 'نفد المخزون', 'Critical': 'حرج', 'Low': 'منخفض', 'Healthy': 'جيد', 'Excess': 'فائض', 'No usage': 'غير مستخدم', 'Requested': 'مطلوب',
  'In transit': 'قيد النقل', 'Received': 'مستلم', 'Rejected': 'مرفوض', 'Cancelled': 'ملغى', 'Draft': 'مسودة', 'Sent': 'مرسل', 'Completed': 'مكتمل',
  'Simulated': 'محاكاة', 'Sending': 'جارٍ الإرسال', 'Failed': 'فشل', 'Trusted': 'موثوق', 'You': 'أنت', 'Signing member': 'عضو موقِّع',

  // stock dashboard & inventory
  'Auto-order from trusted suppliers': 'طلب تلقائي من الموردين الموثوقين', 'Critical / out of stock': 'حرج / نفد', 'runs out before a delivery': 'ينفد قبل وصول التوريد',
  'Below reorder point': 'تحت حد إعادة الطلب', 'order soon': 'اطلب قريباً', 'Excess items': 'أصناف فائضة', 'spoilage risk · can be transferred': 'خطر تلف · يمكن تحويله',
  'Stock on hand': 'المخزون المتوفر', 'at best trusted price': 'بأفضل سعر موثوق', 'Sales last 24h': 'مبيعات آخر ٢٤ ساعة', 'Inbound': 'وارد',
  'Needs attention': 'يحتاج انتباهاً', 'covered by inbound': 'مغطى بالوارد', 'Everything is above its reorder point.': 'كل شيء فوق حد إعادة الطلب.',
  'Rebalance between branches': 'إعادة التوزيع بين الفروع', 'surplus → shortage': 'فائض ← نقص', 'No surplus matches a shortage right now.': 'لا يوجد فائض يقابل نقصاً حالياً.',
  'Branch network': 'شبكة الفروع', 'Send now': 'إرسال الآن', 'Request': 'طلب', 'Switch': 'تبديل', 'Stock value': 'قيمة المخزون', 'Sales 24h': 'مبيعات ٢٤ ساعة', 'Open POs': 'أوامر شراء مفتوحة',
  'Transfer dispatched and signed onto the ledger': 'أُرسل التحويل ووُقّع في السجل', 'Request signed onto the ledger': 'وُقّع الطلب في السجل',
  'Thresholds': 'الحدود', 'Search ingredient or category': 'ابحث عن مكوّن أو فئة', 'Daily use': 'الاستهلاك اليومي', 'Days of cover': 'أيام التغطية',
  'Reorder / target': 'إعادة الطلب / الهدف', 'Order': 'الطلب', 'Surplus': 'الفائض', 'Count': 'جرد', 'Waste': 'هدر', 'No ingredients match.': 'لا توجد مكوّنات مطابقة.',
  'Save count': 'حفظ الجرد', 'Count saved': 'تم حفظ الجرد', 'Reason': 'السبب', 'spoiled': 'تالف', 'dropped / damaged': 'سقط / تضرر', 'expired': 'منتهي الصلاحية', 'other': 'أخرى',
  'Record': 'تسجيل', 'Waste recorded': 'تم تسجيل الهدر', 'Stock thresholds': 'حدود المخزون', 'Safety days (reorder point)': 'أيام الأمان (حد إعادة الطلب)',
  'Target days of cover': 'أيام التغطية المستهدفة', 'Excess above (days of cover)': 'فائض فوق (أيام التغطية)', 'Thresholds updated': 'تم تحديث الحدود',
  "Applied on top of each supplier's lead time. Fresh items are capped by shelf life.": 'تُضاف إلى مدة توريد كل مورد. الأصناف الطازجة محدودة بمدة صلاحيتها.',

  // suppliers & purchasing
  'Send to supplier': 'إرسال للمورد', 'Mark received': 'تأكيد الاستلام',
  'Only trusted suppliers can receive orders. The best supplier per item balances price and on-time delivery.': 'لا يُطلب إلا من الموردين الموثوقين. يُختار أفضل مورد لكل صنف حسب السعر والالتزام بالمواعيد.',
  'New purchase order': 'أمر شراء جديد', 'Auto-order shortages': 'طلب النواقص تلقائياً', 'Supplier': 'المورد', 'Lines': 'البنود', 'Expected': 'الموعد المتوقع',
  'No purchase orders yet. Use “Auto-order shortages” to draft them from the forecast.': 'لا توجد أوامر شراء بعد. استخدم «طلب النواقص تلقائياً» لإنشائها من التوقعات.',
  'Rating': 'التقييم', 'On time': 'الالتزام بالموعد', 'Trusted supplier': 'مورد موثوق', 'Quantity': 'الكمية', 'Create draft': 'إنشاء مسودة', 'Draft created': 'تم إنشاء المسودة',

  // transfers & ledger
  'Branch transfers': 'التحويلات بين الفروع', 'Every movement of stock between branches is a signed block on the shared ledger. Each branch can only sign its own side.':
    'كل حركة مخزون بين الفروع كتلة موقّعة في السجل المشترك. لا يوقّع كل فرع إلا على جانبه.',
  'Request stock': 'طلب مخزون', 'Send stock': 'إرسال مخزون', 'Transfer': 'التحويل', 'Route': 'المسار', 'Last update': 'آخر تحديث', 'No transfers yet.': 'لا توجد تحويلات بعد.',
  'Shared ledger': 'السجل المشترك', 'Re-verify chain': 'إعادة التحقق من السلسلة', 'Confirm receipt': 'تأكيد الاستلام', 'Reject request': 'رفض الطلب',
  'Request rejected': 'تم رفض الطلب', 'Dispatched – block added to ledger': 'أُرسل – أُضيفت كتلة إلى السجل', 'Request added to ledger': 'أُضيف الطلب إلى السجل',
  'Request approved and dispatched': 'تمت الموافقة على الطلب وإرساله', 'Every block verified': 'تم التحقق من كل الكتل', 'Ledger': 'السجل', 'Note': 'ملاحظة',

  // live prices
  'Refresh now': 'تحديث الآن', 'Pause feed': 'إيقاف التحديث', 'Search ingredient': 'ابحث عن مكوّن', 'Market price': 'سعر السوق', 'Trend': 'الاتجاه', 'Change': 'التغيّر',
  'Best trusted offer': 'أفضل عرض موثوق', 'All supplier quotes': 'كل عروض الموردين', 'Menu cost at live prices': 'تكلفة القائمة بالأسعار الحالية', 'Dish': 'الطبق',
  'Food cost': 'تكلفة الطعام', 'Food cost %': 'نسبة تكلفة الطعام', 'Margin per dish': 'الهامش لكل طبق', 'no trusted supplier': 'لا يوجد مورد موثوق',

  // setup tab
  'Everything here can be edited, so you can turn the demo into your own business. Changes save straight away and show up on every screen.':
    'كل ما هنا قابل للتعديل لتحويل النموذج إلى مطعمك. تُحفظ التغييرات فوراً وتظهر في كل الشاشات.',
  'Edit restaurant profile': 'تعديل ملف المطعم', 'Ingredients': 'المكوّنات', 'Branches': 'الفروع', 'Price': 'السعر', 'Recipe (per portion)': 'الوصفة (للحصة)', 'Name': 'الاسم', 'Shelf life': 'الصلاحية',
  'Used in': 'مستخدم في', 'none – no price': 'لا يوجد – بلا سعر', 'Supplies': 'يورّد', 'nothing yet': 'لا شيء بعد', 'Add supplier': 'إضافة مورد', 'Add ingredient': 'إضافة مكوّن',
  'Add branch': 'إضافة فرع', 'Branch': 'الفرع', 'Location': 'الموقع', 'Business details': 'بيانات النشاط', 'Business / group name': 'اسم النشاط / المجموعة',
  'Save details': 'حفظ البيانات', 'Details saved': 'تم حفظ البيانات', 'Your data': 'بياناتك', 'Export JSON': 'تصدير JSON', 'Import file': 'استيراد ملف', 'Paste JSON': 'لصق JSON',
  'Start over': 'البدء من جديد', 'Blank template': 'قالب فارغ', 'Demo data': 'بيانات تجريبية', 'Start from blank': 'البدء من الصفر', 'Restore demo data': 'استعادة البيانات التجريبية',
  'Demo data restored': 'تمت استعادة البيانات التجريبية', 'Blank template ready – start by adding ingredients': 'القالب الفارغ جاهز – ابدأ بإضافة المكوّنات',
  'Data imported': 'تم استيراد البيانات', 'Data imported – a fresh ledger was started for the imported branches': 'تم الاستيراد – بدأ سجل جديد للفروع المستوردة',
  'Export data': 'تصدير البيانات', 'Copy to clipboard': 'نسخ', 'Copied – paste it into a .json file': 'تم النسخ – الصقه في ملف json.',
  'Paste exported data': 'الصق البيانات المصدّرة', 'This replaces the current data and starts a fresh ledger for the imported branches.': 'سيستبدل هذا البيانات الحالية ويبدأ سجلاً جديداً للفروع المستوردة.',
  'Supplier name': 'اسم المورد', 'Contact': 'التواصل', 'Rating (0–5)': 'التقييم (٠–٥)', 'On-time delivery %': 'نسبة التسليم في الموعد',
  'Trusted supplier – allowed to receive purchase orders': 'مورد موثوق – يمكن إرسال أوامر الشراء إليه', 'Catalog item': 'صنف الكتالوج', 'List price': 'سعر القائمة',
  'Lead days': 'أيام التوريد', 'Min order': 'أقل طلب', '+ Add catalog item': '+ إضافة صنف', 'Branch name': 'اسم الفرع',
  'The new branch gets its own signing key, and HQ adds it to the ledger with a new block, so it can send and receive transfers right away. Stock starts at 0.':
    'يحصل الفرع الجديد على مفتاح توقيع خاص، ويضيفه المقر الرئيسي إلى السجل بكتلة جديدة ليتمكن من التحويل فوراً. يبدأ المخزون من الصفر.',
  "Starts at 0 in every branch. Add it to a supplier's catalog to get a live price, and to a dish's recipe so orders use it.":
    'يبدأ من الصفر في كل فرع. أضفه إلى كتالوج مورد ليحصل على سعر مباشر، وإلى وصفة طبق لتستهلكه الطلبات.',
});
